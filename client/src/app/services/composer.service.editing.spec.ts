import { TestBed } from '@angular/core/testing';

import { ComposerService } from './composer.service';
import { toolStateOf } from './composer-tool-states';
import { writtenBeats, writtenOf } from './written-beats';
import { ComposerState } from '../models/composer.model';

/**
 * The service commands M2's palette and keyboard reach, beyond M1's.
 *
 * Each `describe` belongs to one task of the M2 plan. The pure edit functions under these commands
 * have their own specs; what is pinned here is what only the service can get wrong - a range pressed
 * as one undo step, a refusal published and nothing committed, the selection after the press.
 */

/** The service's current state. */
function stateOf(service: ComposerService): ComposerState {
  let latest: ComposerState | undefined;
  service.getState().subscribe(value => (latest = value)).unsubscribe();
  if (!latest) throw new Error('no state');
  return latest;
}

/** Writes `fret` on tab string `string` at bar `barIndex`, beat `beatIndex`, leaving the caret there. */
function writeFret(service: ComposerService, barIndex: number, beatIndex: number, fret: number, string = 1): void {
  service.setCursor({ barIndex, beatIndex, stringIndex: string - 1 });
  service.setNoteAtCursor({ kind: 'fretted', string, fret }, false);
}

/** The first track's beats in bar `barIndex`. */
function beatsIn(service: ComposerService, barIndex = 0) {
  return service.doc.tracks[0].staves[0].bars[barIndex].voices[0].beats;
}

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

describe('ComposerService beats over the selection', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('rests every beat of a range as one undo step', () => {
    writeFret(service, 0, 0, 5);
    writeFret(service, 0, 1, 7);
    service.setCursor({ beatIndex: 0 });
    service.extendSelectionTo({ beatIndex: 1 });

    service.clearSelectionToRests();
    expect(beatsIn(service).slice(0, 2).every(beat => beat.isRest)).toBeTrue();

    service.undo();
    expect(beatsIn(service).slice(0, 2).every(beat => !beat.isRest)).toBeTrue();
  });

  it('takes attacks off a beat cleared at the caret, as over a range, keeping its dynamic', () => {
    writeFret(service, 0, 0, 5);
    service.toggleBeatEffect('tap', true, false);
    service.toggleBeatEffect('pickStroke', 'down', 'none');
    service.setDynamics('pp');

    service.deleteAtCursor();

    expect(beatsIn(service)[0].isRest).toBeTrue();
    expect([beatsIn(service)[0].effects.tap, beatsIn(service)[0].effects.pickStroke, beatsIn(service)[0].dynamics]).toEqual([false, 'none', 'pp']);
  });

  it('inserts a rest at the input duration in front of the caret, and leaves the caret on it', () => {
    writeFret(service, 0, 1, 5);
    service.setInputDuration(8, 0);

    service.insertBeat();

    expect(beatsIn(service)[1].isRest).toBeTrue();
    expect(beatsIn(service)[1].duration).toBe(8);
    expect(beatsIn(service)[2].isRest).toBeFalse();
    expect(stateOf(service).cursor.beatIndex).toBe(1);
  });

  it('deletes a range and puts the caret where it began, with no range', () => {
    writeFret(service, 0, 3, 5);
    service.setCursor({ beatIndex: 1 });
    service.extendSelectionTo({ beatIndex: 2 });

    service.deleteBeats();

    expect(beatsIn(service)[1].isRest).toBeFalse();
    expect(stateOf(service).cursor.beatIndex).toBe(1);
    expect(stateOf(service).anchor).toBeNull();
  });

  it('publishes a delete once, so nothing sees the new document with the old selection', () => {
    service.setCursor({ beatIndex: 1 });
    service.extendSelectionTo({ beatIndex: 2 });
    const published: ComposerState[] = [];
    const subscription = service.getState().subscribe(state => published.push(state));
    published.length = 0;

    service.deleteBeats();
    subscription.unsubscribe();

    expect(published.length).toBe(1);
    expect(published[0].anchor).toBeNull();
  });

  it('keeps a range on its beats when a beat is inserted inside it, the caret on the new rest', () => {
    // The range runs back from beat 2 to beat 1. The rest goes in front of the caret's beat 1, so the
    // anchor's beat moves to index 3 and the anchor goes with it.
    writeFret(service, 0, 2, 5);
    service.setCursor({ beatIndex: 2 });
    service.extendSelectionTo({ beatIndex: 1 });

    service.insertBeat();

    expect(stateOf(service).cursor.beatIndex).toBe(1);
    expect(beatsIn(service)[1].isRest).toBeTrue();
    expect(stateOf(service).anchor?.beatIndex).toBe(3);
    expect(beatsIn(service)[3].isRest).toBeFalse();
  });

  it('refuses to insert into a generated track', () => {
    service.addTrack('Piano', 0, false);
    service.replaceDocument({
      ...service.doc,
      tracks: service.doc.tracks.map((track, index) =>
        index === 1 ? { ...track, generated: { progressionId: 'p', progressionName: 'Verse', source: { kind: 'revision' as const, revision: 1 } } } : track
      )
    });
    service.setCursor({ trackIndex: 1 });
    const before = JSON.stringify(service.doc);

    service.insertBeat();

    expect(JSON.stringify(service.doc)).toBe(before);
    expect(stateOf(service).refusal).toMatch(/progression/i);
  });
});

describe('ComposerService cut, copy and paste', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('refuses a paste with nothing copied', () => {
    service.paste();

    expect(stateOf(service).refusal).toMatch(/copied/i);
  });

  it('pastes a copied range at the caret as one undo step', () => {
    writeFret(service, 0, 0, 5);
    writeFret(service, 0, 1, 7);
    service.setCursor({ beatIndex: 0 });
    service.extendSelectionTo({ beatIndex: 1 });
    service.copy();
    service.setCursor({ barIndex: 2, beatIndex: 0 });

    service.paste();
    expect(beatsIn(service, 2).slice(0, 2).map(beat => beat.notes[0]?.pitch)).toEqual([
      { kind: 'fretted', string: 1, fret: 5 },
      { kind: 'fretted', string: 1, fret: 7 }
    ]);

    service.undo();
    expect(beatsIn(service, 2).every(beat => beat.isRest)).toBeTrue();
  });

  it('pastes over a forward selection from its start, and drops the range', () => {
    writeFret(service, 0, 0, 5);
    writeFret(service, 0, 1, 7);
    service.setCursor({ beatIndex: 0 });
    service.extendSelectionTo({ beatIndex: 1 });
    service.copy();
    service.setCursor({ barIndex: 2, beatIndex: 1 });
    service.extendSelectionTo({ beatIndex: 2 });

    service.paste();

    expect(beatsIn(service, 2).map(beat => (beat.notes[0]?.pitch.kind === 'fretted' ? beat.notes[0].pitch.fret : null))).toEqual([null, 5, 7, null]);
    expect(stateOf(service).anchor).toBeNull();
    expect(stateOf(service).cursor.barIndex).toBe(2);
    expect(stateOf(service).cursor.beatIndex).toBe(1);
  });

  it('says nothing is selected when a copy has no beat to take', () => {
    const empty = structuredClone(service.doc);
    empty.tracks[0].staves[0].bars[0].voices[0].beats = [];
    service.replaceDocument(empty);

    service.copy();

    expect(stateOf(service).refusal).toBe('Nothing is selected.');
  });

  it('cuts by copying and clearing, and the cut pastes back', () => {
    writeFret(service, 0, 0, 5);
    service.setCursor({ beatIndex: 0 });

    service.cut();
    expect(beatsIn(service)[0].isRest).toBeTrue();

    service.paste();
    expect(beatsIn(service)[0].notes[0].pitch).toEqual({ kind: 'fretted', string: 1, fret: 5 });
  });
});

describe('ComposerService bars over the selection', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('closes a repeat over the selected bars and opens it again', () => {
    service.setCursor({ barIndex: 1 });
    service.extendSelectionTo({ barIndex: 2 });

    service.toggleRepeatClose();
    expect(service.doc.masterBars.map(bar => bar.repeatCount)).toEqual([0, 2, 2, 0]);

    service.toggleRepeatClose();
    expect(service.doc.masterBars.map(bar => bar.repeatCount)).toEqual([0, 0, 0, 0]);
  });

  it('inserts as many bars as are selected, and the selection follows its beats', () => {
    service.setCursor({ barIndex: 1 });
    service.extendSelectionTo({ barIndex: 2 });

    service.insertBarsBeforeSelection();

    expect(service.doc.masterBars.length).toBe(6);
    expect(stateOf(service).anchor?.barIndex).toBe(3);
  });

  it('drops the range after deleting the selected bars, leaving the caret on the bar that took their place', () => {
    service.setCursor({ barIndex: 1 });
    service.extendSelectionTo({ barIndex: 2, beatIndex: 2 });

    service.deleteSelectedBars();

    expect(service.doc.masterBars.length).toBe(2);
    expect(stateOf(service).anchor).toBeNull();
    expect([stateOf(service).cursor.barIndex, stateOf(service).cursor.beatIndex]).toEqual([1, 0]);
  });

  it('refuses to remove the last track, saying why', () => {
    const before = JSON.stringify(service.doc);

    service.removeTrack(0);

    expect(JSON.stringify(service.doc)).toBe(before);
    expect(stateOf(service).refusal).toMatch(/at least one track/i);
  });

  it('refuses to delete every bar, saying why', () => {
    service.selectAllInTrack();

    service.deleteSelectedBars();

    expect(service.doc.masterBars.length).toBe(4);
    expect(stateOf(service).refusal).toMatch(/at least one bar/i);
  });

  it('keeps a 3/4 score in 3/4 when its first bar is removed', () => {
    service.setTimeSignature({ numerator: 3, denominator: 4, isCommon: false });

    service.removeBar(0);

    expect(service.scoreMeter.numerator).toBe(3);
  });
});

/** Replaces the document with one whose first bar is `written` (`writtenBeats`). */
function withFirstBar(service: ComposerService, written: string): void {
  const doc = ComposerService.createEmptyScore();
  doc.tracks[0].staves[0].bars[0].voices[0].beats = writtenBeats(written);
  service.replaceDocument(doc);
}

describe('ComposerService typing over a tuplet beat', () => {
  // Guitar Pro keeps a beat's value when a note is typed over it. Written at the palette's value, a triplet eighth
  // would break its group, which is refused; so a beat in a closed group is written at its own value.
  let service: ComposerService;
  const fret = { kind: 'fretted', string: 1, fret: 3 } as const;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('writes a fret at the triplet eighth\'s own value with the palette on a quarter', () => {
    withFirstBar(service, 'n8t3 r8t3 n8t3 n4 n2');
    service.setCursor({ beatIndex: 1 });

    service.setNoteAtCursor(fret, false);

    expect(stateOf(service).refusal).toBeNull();
    expect(writtenOf(beatsIn(service))).toBe('n8t3 n8t3 n8t3 n4 n2');
    expect(beatsIn(service)[1].notes[0].pitch).toEqual(fret);
    // The palette keeps its choice for the next note; the value buttons show the caret's beat, as written.
    expect(stateOf(service).inputDuration).toBe(4);
    expect(toolStateOf(service.doc, null, stateOf(service).cursor, 'eighth').pressed).toBeTrue();
    expect(toolStateOf(service.doc, null, stateOf(service).cursor, 'quarter').pressed).toBeFalse();
  });

  it('writes a rest with R at the triplet eighth\'s own value', () => {
    withFirstBar(service, 'n8t3 n8t3 n8t3 n4 n2');
    service.setCursor({ beatIndex: 1 });

    service.setRestAtCursor(false);

    expect(stateOf(service).refusal).toBeNull();
    expect(writtenOf(beatsIn(service))).toBe('n8t3 r8t3 n8t3 n4 n2');
  });

  it('writes a triplet quarter at its own value with the palette on an eighth, and advances past it', () => {
    withFirstBar(service, 'r4t3 r4t3 r4t3 n2');
    service.setInputDuration(8, 0);
    service.setCursor({ beatIndex: 0 });

    service.setNoteAtCursor(fret, true);

    expect(stateOf(service).refusal).toBeNull();
    expect(writtenOf(beatsIn(service))).toBe('n4t3 r4t3 r4t3 n2');
    expect(stateOf(service).cursor.beatIndex).toBe(1);
  });

  it('still refuses a note in a group already open, where the beat\'s own value would not help', () => {
    withFirstBar(service, 'n16t6 n16t6 n16t6 n16t6 r2 r4');
    service.setCursor({ beatIndex: 1 });
    const before = JSON.stringify(service.doc);

    service.setNoteAtCursor(fret, false);

    expect(stateOf(service).refusal).toMatch(/break a tuplet group/i);
    expect(JSON.stringify(service.doc)).toBe(before);
  });
});

describe('ComposerService Fix bar and a tuplet group', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('refuses a Fix bar whose bar line falls inside a tuplet group, saying why, and commits nothing', () => {
    // A dotted quarter before a 6:4 group is accepted, leaving the bar a quarter over, as Guitar Pro flags it. Cut at
    // the line, the group's first three sixteenths would stay and its last three would go to bar 2, both open.
    withFirstBar(service, 'n2 n8 n16t6 n16t6 n16t6 n16t6 n16t6 n16t6 r8');
    service.setCursor({ beatIndex: 1 });
    service.applyDurationAtCursor(4, 1);
    expect(stateOf(service).refusal).toBeNull();
    expect(writtenOf(beatsIn(service))).toBe('n2 n4. n16t6 n16t6 n16t6 n16t6 n16t6 n16t6 r8');
    const before = JSON.stringify(service.doc);

    service.fixBar();

    expect(stateOf(service).refusal).toMatch(/bar line falls inside a tuplet group/i);
    expect(JSON.stringify(service.doc)).toBe(before);
  });

  it('carries a whole group that lies past the line', () => {
    withFirstBar(service, 'n2 n4. n8 n8t3 n8t3 n8t3');

    service.fixBar();

    expect(stateOf(service).refusal).toBeNull();
    expect(writtenOf(beatsIn(service, 0))).toBe('n2 n4. n8');
    expect(writtenOf(beatsIn(service, 1))).toBe('n8t3 n8t3 n8t3 r4 r4 r4');
  });
});
