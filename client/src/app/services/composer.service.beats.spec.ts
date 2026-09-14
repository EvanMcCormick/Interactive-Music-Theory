import { TestBed } from '@angular/core/testing';

import { ComposerService } from './composer.service';
import { beatsIn, stateOf, withFirstBar, writeFret } from './composer.service.spec-helper';
import { toolStateOf } from './composer-tool-states';
import { writtenOf } from './written-beats.spec-helper';
import { ComposerState } from '../models/composer.model';

/**
 * The service's commands over the selection's beats and bars, and the clipboard - M2 Tasks 1.6, 1.13 to 1.15. See
 * `composer.service.editing.spec.ts` for what these files pin.
 */

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
