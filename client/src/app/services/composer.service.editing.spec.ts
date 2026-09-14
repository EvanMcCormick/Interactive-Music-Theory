import { TestBed } from '@angular/core/testing';

import { ComposerService } from './composer.service';
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
