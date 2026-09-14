import { TestBed } from '@angular/core/testing';

import { ComposerService } from './composer.service';
import { BeatRef } from './composer-selection';
import { setGrace, toggledValue } from './beat-edits';
import { scoreBarFills } from './bar-fill';
import { graceRefusal } from './edit-refusals';
import { writtenBeats, writtenOf } from './written-beats.spec-helper';
import { BeatDoc, ScoreDoc } from '../models/composer.model';

/**
 * A beat made a grace loses its tuplet, in the same edit (`setGrace`), and the open-group refusal judges what is left.
 *
 * A grace that carries a tuplet starts a group alphaTab never closes on a written value, and a bar's leading one is
 * joined to the group the bar before ends in, which the editor's one-bar reading cannot see (`tupletGroupsOf`). A
 * service fuzz found the grace tool making them: 26 of 1,995 accepted grace presses, each where the voice already held
 * an open group that the press left holding the same beats.
 */

const ref = (beatIndex: number): BeatRef => ({ trackIndex: 0, staffIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex });
const refsFrom = (first: number, last: number): BeatRef[] => Array.from({ length: last - first + 1 }, (_, index) => ref(first + index));
const beatsOf = (doc: ScoreDoc): BeatDoc[] => doc.tracks[0].staves[0].bars[0].voices[0].beats;
const tupletGraces = (doc: ScoreDoc): string[] =>
  beatsOf(doc).flatMap((beat, index) => (beat.effects.grace !== 'none' && beat.tuplet ? [`${index}: ${writtenOf([beat])}`] : []));

function barOf(written: string): ScoreDoc {
  const doc = ComposerService.createEmptyScore();
  doc.tracks[0].staves[0].bars[0].voices[0].beats = writtenBeats(written);
  return doc;
}

/** Presses Grace of `kind` on `refs` as the service does: refused, or made on the document. The refusal, or null. */
function pressGrace(doc: ScoreDoc, refs: readonly BeatRef[], kind: 'beforeBeat' | 'onBeat'): string | null {
  const refusal = graceRefusal(doc, refs, kind);
  if (refusal) return refusal;
  const beats = beatsOf(doc);
  setGrace(doc, refs, toggledValue(refs.map(at => beats[at.beatIndex].effects.grace), kind, 'none'));
  return null;
}

/** The fuzz's bar: the on-beat grace leading the run shortens the mixed group after it, so that group is already open. */
const FUZZ_BAR = 'n8 n4. o g g g n4t3 n8t3 n4 n4';

describe('setGrace and a tuplet', () => {
  it('takes the tuplet off a beat it makes a grace, and leaves it on a grace made an ordinary beat', () => {
    const doc = barOf('n4t3 n4t3 n4t3 n2');

    setGrace(doc, refsFrom(0, 2), 'onBeat');

    expect(beatsOf(doc).slice(0, 3).map(beat => beat.tuplet)).toEqual([null, null, null]);

    const loaded = barOf('n4 g8t3 n8t3 n8t3 n8t3 n2');
    setGrace(loaded, [ref(1)], 'none');
    expect(beatsOf(loaded)[1].tuplet).toEqual({ numerator: 3, denominator: 2 });
  });

  it('refuses the fuzz\'s press on part of an open group, which used to leave a grace carrying the tuplet', () => {
    // Before: `n8 n4. o g o o ot3 n8t3 ...` - the grace held the triplet, and the open group held the same two beats.
    const doc = barOf(FUZZ_BAR);
    const before = JSON.stringify(doc);

    const refusal = pressGrace(doc, refsFrom(4, 6), 'onBeat');

    expect(refusal).toBe('That would break a tuplet group; select the whole group.');
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('makes the whole of that group graces, with no tuplet left and the bar still full', () => {
    const doc = barOf(FUZZ_BAR);

    expect(pressGrace(doc, refsFrom(4, 7), 'onBeat')).toBeNull();

    expect(beatsOf(doc).some(beat => beat.tuplet !== null)).toBeFalse();
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });

  it('never leaves a grace carrying a tuplet, over every run of beats in bars of groups, pressed either way', () => {
    const bars = [
      FUZZ_BAR,
      'n4 o n4t3 n8t3 n2',
      'n4t3 n4t3 n4t3 n2',
      'n8t3 n8t3 n8t3 n8t3 n8t3 n8t3 n2',
      'g n4t3 n8t3 o n8t3 n4t3 n2',
      'n8t6 n8t6 n8t6 n8t6 n8t6 n8t6 g n2',
      'n16t5 n16t5 n16t5 n16t5 n16t5 n4 n2'
    ];
    let accepted = 0;

    for (const written of bars) {
      const length = writtenBeats(written).length;
      for (let first = 0; first < length; first++) {
        for (let last = first; last < length; last++) {
          for (const kind of ['beforeBeat', 'onBeat'] as const) {
            const doc = barOf(written);
            if (pressGrace(doc, refsFrom(first, last), kind) !== null) continue;
            accepted++;
            expect(tupletGraces(doc)).withContext(`${written}, beats ${first}-${last}, ${kind}`).toEqual([]);
          }
        }
      }
    }
    expect(accepted).toBeGreaterThan(0);
  });
});

describe('ComposerService pressing Grace on part of an open tuplet group', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
    service.replaceDocument(barOf(FUZZ_BAR));
  });

  it('refuses, committing nothing, and takes the whole group without a tuplet', () => {
    const before = JSON.stringify(service.doc);
    service.setCursor({ barIndex: 0, beatIndex: 4 });
    service.extendSelectionTo({ barIndex: 0, beatIndex: 6 });

    service.toggleGrace('onBeat');

    expect(service.state.refusal).toBe('That would break a tuplet group; select the whole group.');
    expect(JSON.stringify(service.doc)).toBe(before);

    service.setCursor({ barIndex: 0, beatIndex: 4 });
    service.extendSelectionTo({ barIndex: 0, beatIndex: 7 });
    service.toggleGrace('onBeat');

    expect(service.state.refusal).toBeNull();
    expect(tupletGraces(service.doc)).toEqual([]);
  });
});
