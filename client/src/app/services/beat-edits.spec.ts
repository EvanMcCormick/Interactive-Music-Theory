import { ComposerService } from './composer.service';
import { BeatRef } from './composer-selection';
import { setBeatDurations, setGrace, setTuplet, toggleBeatEffect, toggledValue } from './beat-edits';
import { scoreBarFills } from './bar-fill';
import { DurationValue, ScoreDoc, createDefaultNoteEffects, createRestBeat } from '../models/composer.model';

const ref = (barIndex: number, beatIndex: number): BeatRef =>
  ({ trackIndex: 0, staffIndex: 0, barIndex, voiceIndex: 0, beatIndex });
const beats = (doc: ScoreDoc, bar = 0) => doc.tracks[0].staves[0].bars[bar].voices[0].beats;
const withNote = (doc: ScoreDoc, bar: number, beat: number): void => {
  const target = beats(doc, bar)[beat];
  target.isRest = false;
  target.notes = [{ pitch: { kind: 'fretted', string: 1, fret: 0 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
};
/** Each beat of a bar as `n` or `r`, its value and its dots: `n4.`. */
const shape = (doc: ScoreDoc, bar = 0): string[] =>
  beats(doc, bar).map(beat => `${beat.isRest ? 'r' : 'n'}${beat.duration}${'.'.repeat(beat.dots)}`);

describe('toggledValue', () => {
  it('turns on when any target lacks the value', () => {
    expect(toggledValue([true, false], true, false)).toBeTrue();
  });

  it('turns off when every target has it', () => {
    expect(toggledValue(['wide', 'wide'], 'wide', 'none')).toBe('none');
  });

  it('compares structured values by content', () => {
    expect(toggledValue([{ type: 'long', length: 1 }], { type: 'long', length: 1 }, null)).toBeNull();
  });
});

describe('toggleBeatEffect', () => {
  it('sets every beat in the range when the range is mixed', () => {
    const doc = ComposerService.createEmptyScore();
    beats(doc)[1].effects.fadeIn = true;

    toggleBeatEffect(doc, [ref(0, 0), ref(0, 1)], 'fadeIn', true, false);

    expect(beats(doc).slice(0, 2).map(beat => beat.effects.fadeIn)).toEqual([true, true]);
  });
});

describe('setBeatDurations', () => {
  it('fills the gap a shorter beat leaves right after it', () => {
    // The first quarter becomes an eighth. Its gap opens at 480, so the eighth rest goes there
    // and the three quarter rests keep their slots.
    const doc = ComposerService.createEmptyScore();

    setBeatDurations(doc, [ref(0, 0)], 8, 0);

    expect(shape(doc)).toEqual(['r8', 'r8', 'r4', 'r4', 'r4']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });

  it('takes the following rests when a beat gets longer', () => {
    const doc = ComposerService.createEmptyScore();

    setBeatDurations(doc, [ref(0, 0)], 2, 0);

    expect(beats(doc).map(beat => beat.duration)).toEqual([2, 4, 4]);
  });

  it('puts back what a growing beat took beyond its need, right after it', () => {
    // A dotted quarter needs 480 more ticks and takes the whole quarter rest after it. The
    // eighth it did not need goes back at 1440, where the dotted quarter ends.
    const doc = ComposerService.createEmptyScore();
    withNote(doc, 0, 0);

    setBeatDurations(doc, [ref(0, 0)], 4, 1);

    expect(shape(doc)).toEqual(['n4.', 'r8', 'r4', 'r4']);
  });

  it('leaves the bar over rather than overwrite a note', () => {
    const doc = ComposerService.createEmptyScore();
    withNote(doc, 0, 1);

    setBeatDurations(doc, [ref(0, 0)], 2, 0);

    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'over', ticks: 960 });
    expect(beats(doc)[1].isRest).toBeFalse();
  });

  it('spends a shorter beat\'s room on the bar\'s overflow before filling', () => {
    // The first rest grew to a half against a note, leaving the bar 960 over. Shortened back to
    // a quarter it frees 960, which the overflow uses up, so no rest is inserted.
    const doc = ComposerService.createEmptyScore();
    withNote(doc, 0, 1);
    setBeatDurations(doc, [ref(0, 0)], 2, 0);

    setBeatDurations(doc, [ref(0, 0)], 4, 0);

    expect(shape(doc)).toEqual(['r4', 'n4', 'r4', 'r4']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });

  it('changes every beat of a range together', () => {
    const doc = ComposerService.createEmptyScore();

    setBeatDurations(doc, [0, 1, 2, 3].map(index => ref(0, index)), 2, 0);

    expect(beats(doc).map(beat => beat.duration)).toEqual([2, 2, 2, 2]);
  });

  it('settles each beat of a range where its own gap opened', () => {
    // Four quarters set to eighths, last to first. The fourth frees 480 at 3360, the third at
    // 2400, the second at 1440 and the first at 480. Each is settled exactly, so nothing after
    // it moves, and every eighth rest sits right after the eighth that freed it.
    const doc = ComposerService.createEmptyScore();
    [0, 1, 2, 3].forEach(index => withNote(doc, 0, index));

    setBeatDurations(doc, [0, 1, 2, 3].map(index => ref(0, index)), 8, 0);

    expect(shape(doc)).toEqual(['n8', 'r8', 'n8', 'r8', 'n8', 'r8', 'n8', 'r8']);

    const rests = ComposerService.createEmptyScore();
    setBeatDurations(rests, [0, 1, 2, 3].map(index => ref(0, index)), 8, 0);
    expect(shape(rests)).toEqual(['r8', 'r8', 'r8', 'r8', 'r8', 'r8', 'r8', 'r8']);
  });

  it('leaves a grace beat\'s written value to alphaTab, and still settles the bar', () => {
    // A quarter, a grace written as a quarter, and three quarters: full, since a grace takes no
    // room. `Beat.finish` sets a grace's value from the size of its grace group, so a value set
    // here would not survive a save; the grace keeps its quarter. The first beat becomes a
    // sixteenth, and the three sixteenths it frees fill right after it as a dotted eighth - in
    // front of the grace, which still leads into the quarter after it.
    const doc = ComposerService.createEmptyScore();
    beats(doc).splice(1, 0, createRestBeat(4));
    withNote(doc, 0, 1);
    beats(doc)[1].effects.grace = 'beforeBeat';

    setBeatDurations(doc, [ref(0, 0), ref(0, 1)], 16, 0);

    expect(beats(doc).map(beat => `${beat.duration}${'.'.repeat(beat.dots)}`)).toEqual(['16', '8.', '4', '4', '4', '4']);
    expect(beats(doc)[2].effects.grace).toBe('beforeBeat');
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });

  it('leaves a free-time bar as the change made it, taking none of its rests', () => {
    // The meter does not govern a free-time bar, so the quarter that becomes a half takes
    // nothing after it and nothing fills behind it: four beats, a half and three quarters,
    // 4800 ticks - and the bar still reads full, because a free-time bar always does.
    const doc = ComposerService.createEmptyScore();
    doc.masterBars[0].isFreeTime = true;

    setBeatDurations(doc, [ref(0, 0)], 2, 0);

    expect(beats(doc).map(beat => beat.duration)).toEqual([2, 4, 4, 4]);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });
});

describe('setBeatDurations on a range', () => {
  /** An empty score whose first bar is `written`: `n` or `r`, a value and its dots, as `shape` prints. */
  const scoreWith = (written: string): ScoreDoc => {
    const doc = ComposerService.createEmptyScore();
    beats(doc).splice(0, beats(doc).length, ...written.split(' ').map(token => {
      const [, kind, value, dots] = /^([nr])(\d+)(\.*)$/.exec(token) ?? ['', 'r', '4', ''];
      return { ...createRestBeat(Number(value) as DurationValue), dots: dots.length };
    }));
    written.split(' ').forEach((token, index) => {
      if (token.startsWith('n')) withNote(doc, 0, index);
    });
    return doc;
  };
  const refsTo = (count: number): BeatRef[] => Array.from({ length: count }, (_, index) => ref(0, index));

  // Every case below changes beats a range holds together. Settled one at a time, a beat that
  // grows could not take a neighbour that is itself changing, while the room a later beat freed
  // was already spent on rests: the bar read as over when every beat's new length fitted it.

  it('fits a range whose later beats shrink as its earlier ones grow', () => {
    // 960 480 480 1920 to four quarters. The half frees 960; each eighth grows by 480 into its
    // changing neighbour, which the freed room now covers. Nothing needs a rest.
    const doc = scoreWith('n4 n8 n8 n2');

    setBeatDurations(doc, refsTo(4), 4, 0);

    expect(shape(doc)).toEqual(['n4', 'n4', 'n4', 'n4']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });

  it('puts only what is left of the freed room back as rests, where it opened', () => {
    // The half becomes a quarter and frees 960; the eighth before it grows by 480. The bar is 480
    // short, which fills right after the quarter that shrank, at 1920 - so the quarter and eighth
    // rests after it keep their places at 2400 and 3360.
    const doc = scoreWith('n8 n2 r4 r8');

    setBeatDurations(doc, refsTo(2), 4, 0);

    expect(shape(doc)).toEqual(['n4', 'n4', 'r8', 'r4', 'r8']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });

  it('lets a growing beat at the end of the bar use room freed before it', () => {
    // The eighth rest ends the bar and grows by 480 with nothing after it; the eighth grows by
    // 480 into the unchanged quarter. The half frees 960, which covers both.
    const doc = scoreWith('n2 n8 n4 r8');

    setBeatDurations(doc, refsTo(4), 4, 0);

    expect(shape(doc)).toEqual(['n4', 'n4', 'n4', 'r4']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });

  it('gives growth blocked by a changing neighbour the rests after the range', () => {
    // The second eighth rest grows into the third and takes it. The first grows into the second,
    // which is changing, so its 480 is blocked - and the bar is 480 over until the last beat of
    // the range takes the next eighth rest for it.
    const doc = scoreWith('r8 r8 r8 r8 r8 r8 r8 r8');

    setBeatDurations(doc, refsTo(2), 4, 0);

    expect(shape(doc)).toEqual(['r4', 'r4', 'r8', 'r8', 'r8', 'r8']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });

  it('fits two eighths that grow into the room a half frees after them', () => {
    const doc = scoreWith('n8 n8 n4 n2');

    setBeatDurations(doc, refsTo(4), 4, 0);

    expect(shape(doc)).toEqual(['n4', 'n4', 'n4', 'n4']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });

  it('fits a range that becomes dotted quarters, one growing and one shrinking', () => {
    const doc = scoreWith('n4 n2 r4');

    setBeatDurations(doc, refsTo(2), 4, 1);

    expect(shape(doc)).toEqual(['n4.', 'n4.', 'r4']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });

  it('still leaves growth a note blocks as overflow', () => {
    // Both eighths grow by 480, and the notes after the range give nothing: 960 over, as the
    // design asks, and no note is taken.
    const doc = scoreWith('n8 n8 n8 n8 r2');

    setBeatDurations(doc, refsTo(2), 4, 0);

    expect(shape(doc)).toEqual(['n4', 'n4', 'n8', 'n8', 'r2']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'over', ticks: 960 });
  });
});

describe('setGrace', () => {
  it('fills the room a quarter frees by becoming a grace, in front of the grace', () => {
    // A grace takes no room, so a full 4/4 bar whose second quarter becomes a grace is a
    // quarter short. The gap opened where that quarter stood, and the rest goes there - in front
    // of the grace, at the same tick, so the grace still leads into the quarter after it.
    const doc = ComposerService.createEmptyScore();
    withNote(doc, 0, 1);

    setGrace(doc, [ref(0, 1)], 'beforeBeat');

    expect(beats(doc).map(beat => beat.effects.grace)).toEqual(['none', 'none', 'beforeBeat', 'none', 'none']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });

  it('takes the rest a grace led into when it becomes an ordinary beat again', () => {
    // A note, an on-beat grace written as a quarter, and three quarter rests: full. As an
    // ordinary beat the grace takes a quarter's room, and the rest after it is no longer led
    // into by a grace, so it is the room taken.
    const doc = ComposerService.createEmptyScore();
    beats(doc).splice(1, 0, createRestBeat(4));
    withNote(doc, 0, 0);
    withNote(doc, 0, 1);
    beats(doc)[1].effects.grace = 'onBeat';

    setGrace(doc, [ref(0, 1)], 'none');

    expect(beats(doc).map(beat => (beat.isRest ? 'r' : 'n'))).toEqual(['n', 'n', 'r', 'r']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });
});

describe('setTuplet', () => {
  it('makes three quarters a triplet and fills what they freed', () => {
    // Each triplet quarter frees 320 ticks, not a whole number of 64ths, so no rest can go where
    // one opened. Once all three are settled the bar is a quarter short, which fills at its end.
    const doc = ComposerService.createEmptyScore();

    setTuplet(doc, [ref(0, 0), ref(0, 1), ref(0, 2)], { numerator: 3, denominator: 2 });

    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
    expect(beats(doc).length).toBe(5);
  });
});
