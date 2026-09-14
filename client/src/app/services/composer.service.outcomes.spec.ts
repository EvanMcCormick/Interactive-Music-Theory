import { TestBed } from '@angular/core/testing';

import { ComposerService } from './composer.service';
import { beatsIn, stateOf, writeFret } from './composer.service.spec-helper';
import { writtenOf } from './written-beats.spec-helper';

/**
 * What the service says an edit did, in `ComposerState.notice`, and the message id that makes the same words a new
 * message - M2 Task 3.3. See `composer.service.editing.spec.ts` for what these files pin.
 */
describe('ComposerService outcomes', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('says what Fix bar fixed and added, and the next caret move clears it', () => {
    for (const beatIndex of [0, 1, 2, 3]) writeFret(service, 3, beatIndex, beatIndex);
    service.setCursor({ barIndex: 3, beatIndex: 0 });
    service.applyDurationAtCursor(2, 0);

    service.fixBar();
    expect(stateOf(service).notice).toBe('Fixed 1 bar, adding 1 bar at the end.');

    service.moveCursor({ kind: 'beat', delta: 1 });
    expect(stateOf(service).notice).toBeNull();
  });

  it('says what a paste wrote and the bars it added, and a refusal replaces it', () => {
    writeFret(service, 0, 0, 5);
    writeFret(service, 0, 1, 7);
    service.setCursor({ beatIndex: 0 });
    service.extendSelectionTo({ beatIndex: 1 });
    service.copy();
    service.setCursor({ barIndex: 3, beatIndex: 3 });

    service.paste();
    expect(stateOf(service).notice).toBe('Pasted 2 beats, adding 1 bar at the end.');

    service.fixBar();
    expect(stateOf(service).notice).toBeNull();
    expect(stateOf(service).refusal).toMatch(/over/i);
  });

  it('says a fermata was removed on the commit that removed it, and the next caret move clears it', () => {
    // The first guitar's quarters, with a fermata on the second; then a second guitar whose bar is a half then two
    // quarters, so nothing of it starts at 960, where the fermata is - but a quarter starts at 1920.
    for (const beatIndex of [0, 1, 2, 3]) writeFret(service, 0, beatIndex, beatIndex);
    service.setCursor({ barIndex: 0, beatIndex: 1 });
    service.toggleFermata();
    service.addTrack('Guitar', 25, true);
    service.setCursor({ trackIndex: 1, barIndex: 0, beatIndex: 0 });
    service.applyDurationAtCursor(2, 0);
    expect(stateOf(service).notice).toBeNull();

    // The first quarter made a half pushes the fermata's note to 1920, where it would reach the second guitar.
    service.setCursor({ trackIndex: 0, barIndex: 0, beatIndex: 0 });
    service.applyDurationAtCursor(2, 0);
    expect(stateOf(service).notice).toBe('1 fermata removed: its note moved where it would reach other tracks.');
    expect(service.doc.tracks[0].staves[0].bars[0].voices[0].beats.some(beat => beat.effects.fermata)).toBeFalse();

    service.moveCursor({ kind: 'beat', delta: 1 });
    expect(stateOf(service).notice).toBeNull();
  });

  it('counts every selected bar Fix bar mends, a bar an earlier bar\'s carry mended on the way included', () => {
    // Bars 0 and 1 each start with a half rest before three quarters, so each is over by a quarter.
    const doc = ComposerService.createEmptyScore();
    for (const barIndex of [0, 1]) doc.tracks[0].staves[0].bars[barIndex].voices[0].beats[0].duration = 2;
    service.replaceDocument(doc);
    service.setCursor({ barIndex: 0, beatIndex: 0 });
    service.extendSelectionTo({ barIndex: 1, beatIndex: 0 });

    service.fixBar();

    expect(stateOf(service).refusal).toBeNull();
    expect(stateOf(service).notice).toMatch(/^Fixed 2 bars[.,]/);
  });

  it('gives every refusal and notice it publishes a new message id, so the same words said twice are two messages', () => {
    service.fixBar();
    const refused = stateOf(service);
    service.fixBar();
    expect(stateOf(service).refusal).toBe(refused.refusal);
    expect(stateOf(service).messageId).toBeGreaterThan(refused.messageId);

    const afterRefusals = stateOf(service).messageId;
    service.moveCursor({ kind: 'beat', delta: 1 });
    writeFret(service, 0, 0, 5);
    expect(stateOf(service).messageId).toBe(afterRefusals);

    service.copy();
    service.setCursor({ barIndex: 1, beatIndex: 0 });
    service.paste();
    const pasted = stateOf(service);
    service.paste();
    expect(stateOf(service).notice).toBe(pasted.notice);
    expect(stateOf(service).messageId).toBeGreaterThan(pasted.messageId);
  });

  /**
   * The first guitar's quarters with a fermata on the second, beside a second guitar that starts with a half, and the
   * input duration a half: a note or a rest typed over the first quarter pushes the fermata's note to 1920, where it
   * would reach the second guitar, as in the case above. Leaves the caret on the first guitar's first beat.
   */
  function fermataBesideAHalf(): void {
    for (const beatIndex of [0, 1, 2, 3]) writeFret(service, 0, beatIndex, beatIndex);
    service.setCursor({ barIndex: 0, beatIndex: 1 });
    service.toggleFermata();
    service.addTrack('Guitar', 25, true);
    service.setCursor({ trackIndex: 1, barIndex: 0, beatIndex: 0 });
    service.applyDurationAtCursor(2, 0);
    service.setCursor({ trackIndex: 0, barIndex: 0, beatIndex: 0, stringIndex: 0 });
  }

  const FERMATA_REMOVED = '1 fermata removed: its note moved where it would reach other tracks.';

  it('says a typed fret removed a fermata, through the caret\'s advance and through the second digit', () => {
    fermataBesideAHalf();
    const target = stateOf(service).cursor;

    service.setNoteAtCursor({ kind: 'fretted', string: 1, fret: 1 }, true);
    expect(stateOf(service).cursor.beatIndex).toBe(1);
    expect(stateOf(service).notice).toBe(FERMATA_REMOVED);
    const announced = stateOf(service).messageId;

    service.retypeNote(target, { kind: 'fretted', string: 1, fret: 12 });
    expect(beatsIn(service)[0].notes[0].pitch).toEqual({ kind: 'fretted', string: 1, fret: 12 });
    expect(stateOf(service).notice).toBe(FERMATA_REMOVED);
    expect(stateOf(service).messageId).toBe(announced);
  });

  it('says a typed rest removed a fermata, through the caret\'s advance', () => {
    fermataBesideAHalf();

    service.setRestAtCursor(true);

    expect(stateOf(service).cursor.beatIndex).toBe(1);
    expect(stateOf(service).notice).toBe(FERMATA_REMOVED);
  });

  it('counts the beats a paste wrote: a grace is none, and a beat split at a bar line is two', () => {
    writeFret(service, 0, 0, 5);
    writeFret(service, 0, 1, 7);
    service.setCursor({ beatIndex: 0 });
    service.toggleGrace('beforeBeat');
    const grace = beatsIn(service).findIndex(beat => beat.effects.grace === 'beforeBeat');
    service.setCursor({ barIndex: 0, beatIndex: grace });
    service.extendSelectionTo({ beatIndex: grace + 1 });
    service.copy();
    service.setCursor({ barIndex: 3, beatIndex: 0 });
    service.paste();
    expect(stateOf(service).notice).toBe('Pasted 1 beat.');

    writeFret(service, 1, 0, 3);
    service.applyDurationAtCursor(2, 0);
    service.copy();
    service.setCursor({ barIndex: 2, beatIndex: 3 });
    service.paste();
    expect(writtenOf(beatsIn(service, 2))).toMatch(/n4$/);
    expect(stateOf(service).notice).toBe('Pasted 2 beats.');
  });
});
