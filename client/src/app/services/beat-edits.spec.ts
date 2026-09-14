import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { ComposerService } from './composer.service';
import { BeatRef } from './composer-selection';
import {
  clearToRests,
  deleteBeats,
  fermataPositionsOf,
  insertBeatAt,
  setBeatDots,
  setBeatDurations,
  setGrace,
  setTuplet,
  toggleBeatEffect,
  toggleFermata,
  toggledValue
} from './beat-edits';
import { scoreBarFills } from './bar-fill';
import { fermataRefusal } from './edit-refusals';
import { ScoreDocMapperService } from './score-doc-mapper.service';
import { DurationValue, ScoreDoc, createDefaultBeatEffects, createDefaultNoteEffects, createRestBeat } from '../models/composer.model';

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

  it('compares structured values whatever order their keys were written in', () => {
    // A value read back through the mapper and one built by a tool can list the same fields in a
    // different order; that is still the same value, so the press turns it off.
    expect(toggledValue([{ length: 1, type: 'long' }], { type: 'long', length: 1 }, null)).toBeNull();
    expect(toggledValue([{ value: 62, speed: 16 }, { speed: 16, value: 62 }], { speed: 16, value: 62 }, null)).toBeNull();
    expect(toggledValue([{ length: 1, type: 'long' }], { type: 'long', length: 2 }, null)).toEqual({ type: 'long', length: 2 });
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

  it('leaves a second voice alone, since bar filling cannot measure it', () => {
    // `editRefusal` refuses this before it gets here; the length edit refuses it too, rather
    // than change a voice whose bar it would then settle against voice 1.
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[0].voices.push({ beats: [4, 4, 4, 4].map(() => createRestBeat(4)) });
    const before = JSON.stringify(doc);

    setBeatDurations(doc, [{ ...ref(0, 0), voiceIndex: 1 }], 8, 0);

    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('setBeatDots', () => {
  it('dots each beat at its own value, settling the bar, and leaves a grace alone', () => {
    // A half dotted grows by a quarter and takes the quarter rest after it. The grace, in front of the
    // last quarter, keeps its value: alphaTab sets a grace's.
    const doc = ComposerService.createEmptyScore();
    setBeatDurations(doc, [ref(0, 0)], 2, 0);
    withNote(doc, 0, 0);
    beats(doc).splice(2, 0, createRestBeat(8));
    beats(doc)[2].effects.grace = 'beforeBeat';

    setBeatDots(doc, [ref(0, 0), ref(0, 2)], 1);

    expect(shape(doc)).toEqual(['n2.', 'r8', 'r4']);
    expect(beats(doc)[1].dots).toBe(0);
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

  // The next three bars arrive over already. Each range's first beat grows into its changing
  // neighbour, and the neighbour's own shrink - or the spare rest it took - pays for that growth
  // exactly. The range's lengths change the bar's total by nothing, so its overflow must stay what
  // it was, and no rest after the range may go to pay for growth that is already paid for.

  it('keeps an over bar\'s overflow when a range\'s shrink pays for its growth', () => {
    // 480 1440 960 960 960 960, 1920 over. The dotted quarter frees 480 and the eighth grows 480.
    const doc = scoreWith('n8 n4. r4 r4 n4 n4');

    setBeatDurations(doc, refsTo(2), 4, 0);

    expect(shape(doc)).toEqual(['n4', 'n4', 'r4', 'r4', 'n4', 'n4']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'over', ticks: 1920 });
  });

  it('keeps an over bar\'s overflow when it is less than the growth paid for', () => {
    // 960 over, more than the 480 the eighth grows, so taking rests would not be capped by it.
    const doc = scoreWith('n8 n4. r4 r4 n4');

    setBeatDurations(doc, refsTo(2), 4, 0);

    expect(shape(doc)).toEqual(['n4', 'n4', 'r4', 'r4', 'n4']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'over', ticks: 960 });
  });

  it('keeps an over bar\'s overflow when a growing beat\'s spare rest pays for its neighbour', () => {
    // 1920 over. The second eighth grows 480 into the quarter rest after it and takes it all,
    // freeing the 480 it did not need; that is the room the first eighth's blocked 480 wanted.
    const doc = scoreWith('n8 n8 r4 r4 r4 n4 n4');

    setBeatDurations(doc, refsTo(2), 4, 0);

    expect(shape(doc)).toEqual(['n4', 'n4', 'r4', 'r4', 'n4', 'n4']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'over', ticks: 1920 });
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

  it('puts a whole group\'s freed room right after the group, so the beats after it keep their ticks', () => {
    // `n8 n8 n8 n8 n2`. Each eighth made a triplet eighth frees 160 ticks - off the 64th grid, so no
    // rest can go after any one of them. Together they free 480, an eighth rest right after the
    // group, and the fourth eighth stays at 1440 rather than moving to 960.
    const doc = ComposerService.createEmptyScore();
    beats(doc).splice(0, beats(doc).length, ...([8, 8, 8, 8, 2] as DurationValue[]).map(value => createRestBeat(value)));
    [0, 1, 2, 3, 4].forEach(index => withNote(doc, 0, index));

    setTuplet(doc, [ref(0, 0), ref(0, 1), ref(0, 2)], { numerator: 3, denominator: 2 });

    expect(shape(doc)).toEqual(['n8', 'n8', 'n8', 'r8', 'n8', 'n2']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });

  // A group whose members each free a remainder that becomes spellable part-way through - a 6:4 beat
  // frees a third of its value, so three of them free a whole value - must still get its room after the
  // group. A rest placed mid-group ends alphaTab's `TupletGroup` there (`check`, ~6760), and the two
  // halves are drawn as two broken groups.

  /** Bar 0 as `n` or `r` with a value, from `written`, every beat a note. */
  const notesOf = (written: string): ScoreDoc => {
    const doc = ComposerService.createEmptyScore();
    const values = written.split(' ').map(token => Number(token.slice(1)) as DurationValue);
    beats(doc).splice(0, beats(doc).length, ...values.map(value => createRestBeat(value)));
    values.forEach((_, index) => withNote(doc, 0, index));
    return doc;
  };
  /** `shape`, with `tN` after a beat under an N:M tuplet. */
  const tupletShape = (doc: ScoreDoc): string[] =>
    beats(doc).map(beat => `${beat.isRest ? 'r' : 'n'}${beat.duration}${beat.tuplet ? `t${beat.tuplet.numerator}` : ''}`);
  const sextuplet = { numerator: 6, denominator: 4 };
  const refsFrom = (first: number, count: number): BeatRef[] => Array.from({ length: count }, (_, index) => ref(0, first + index));

  it('keeps a 6:4 group of sixteenths whole, its eighth of room after the sixth', () => {
    // Each sixteenth becomes 160 ticks and frees 80; the six free 480, at 960.
    const doc = notesOf('n16 n16 n16 n16 n16 n16 n2 n8');

    setTuplet(doc, refsFrom(0, 6), sextuplet);

    expect(tupletShape(doc)).toEqual(['n16t6', 'n16t6', 'n16t6', 'n16t6', 'n16t6', 'n16t6', 'r8', 'n2', 'n8']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });

  it('keeps a 6:4 group of eighths whole, its quarter of room after the sixth', () => {
    const doc = notesOf('n8 n8 n8 n8 n8 n8 n4');

    setTuplet(doc, refsFrom(0, 6), sextuplet);

    expect(tupletShape(doc)).toEqual(['n8t6', 'n8t6', 'n8t6', 'n8t6', 'n8t6', 'n8t6', 'r4', 'n4']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });

  it('keeps a 6:4 group that starts mid-bar whole', () => {
    const doc = notesOf('n4 n8 n8 n8 n8 n8 n8');

    setTuplet(doc, refsFrom(1, 6), sextuplet);

    expect(tupletShape(doc)).toEqual(['n4', 'n8t6', 'n8t6', 'n8t6', 'n8t6', 'n8t6', 'n8t6', 'r4']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });

  it('gives each of two 3:2 groups over six eighths its own room, so the second group keeps its tick', () => {
    // alphaTab closes an equal-length 3:2 group at its third beat, so a rest after it breaks nothing:
    // the second group still starts at 1440, where the fourth eighth was.
    const doc = notesOf('n8 n8 n8 n8 n8 n8 n4');

    setTuplet(doc, refsFrom(0, 6), { numerator: 3, denominator: 2 });

    expect(tupletShape(doc)).toEqual(['n8t3', 'n8t3', 'n8t3', 'r8', 'n8t3', 'n8t3', 'n8t3', 'r8', 'n4']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });

  it('holds the room until a group that runs on past the press closes, so no rest splits it', () => {
    // Beats 3 to 5 are already 6:4 and the bar is full. Made 6:4 too, beats 0 to 2 join them in one group
    // of six, which alphaTab closes at beat 5: the sixteenth the three free goes after beat 5, not after
    // beat 2, where the group is still open though the next beat is not being changed.
    const doc = notesOf('n16 n16 n16 n16 n16 n16 n2 n8 n16');
    beats(doc).slice(3, 6).forEach(beat => (beat.tuplet = { ...sextuplet }));

    setTuplet(doc, refsFrom(0, 3), sextuplet);

    expect(tupletShape(doc)).toEqual(['n16t6', 'n16t6', 'n16t6', 'n16t6', 'n16t6', 'n16t6', 'r16', 'n2', 'n8', 'n16']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });
});

describe('setGrace at a fermata', () => {
  // alphaTab files a beat's fermata at the tick the beat is finished at, and hands it to every beat finished
  // there later without one (`Voice.finish` ~3294, `MasterBar.getFermata` ~2728). A grace is finished at
  // the tick of the beat it leads into. So a quarter that becomes a grace would carry its fermata one
  // position on, to every track, if it kept it.
  let mapper: ScoreDocMapperService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    mapper = TestBed.inject(ScoreDocMapperService);
  });

  const fermatas = (doc: ScoreDoc): (string | null)[][] =>
    doc.tracks.map(track => track.staves[0].bars[0].voices[0].beats.map(beat => beat.effects.fermata?.type ?? null));
  /** A guitar, a piano and an organ, every quarter a note, with a fermata on every track's second quarter. */
  const withFermata = (): ScoreDoc => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    doc.tracks.push(ComposerService.createTrack('Organ', 'org', 16, false, doc.masterBars));
    [0, 1, 2, 3].forEach(index => withNote(doc, 0, index));
    for (const track of doc.tracks.slice(1)) {
      for (const beat of track.staves[0].bars[0].voices[0].beats) {
        beat.isRest = false;
        beat.notes = [{ pitch: { kind: 'pitched', noteValue: 0, octave: 4 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
      }
    }
    for (const track of doc.tracks) track.staves[0].bars[0].voices[0].beats[1].effects.fermata = { type: 'medium', length: 1 };
    return doc;
  };

  for (const kind of ['beforeBeat', 'onBeat'] as const) {
    it(`leaves the fermata at its position when the beat there becomes a ${kind} grace, so a save adds none`, () => {
      const doc = withFermata();

      setGrace(doc, [{ ...ref(0, 1), trackIndex: 1 }], kind);

      // The rest that fills the quarter's place holds the position's fermata; the grace, now at the third
      // quarter's position, holds that position's, which is none.
      expect(fermatas(doc)).toEqual([[null, 'medium', null, null], [null, 'medium', null, null, null], [null, 'medium', null, null]]);
      expect(fermatas(mapper.toDoc(mapper.toScore(doc, new alphaTab.Settings())))).toEqual(fermatas(doc));
    });
  }
});

describe('toggleFermata', () => {
  const medium = { type: 'medium' as const, length: 1 };
  /** Each beat's fermata type in bar 0 of track `trackIndex`, or null. */
  const fermatas = (doc: ScoreDoc, trackIndex: number): (string | null)[] =>
    doc.tracks[trackIndex].staves[0].bars[0].voices[0].beats.map(beat => beat.effects.fermata?.type ?? null);
  const withPiano = (): ScoreDoc => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    return doc;
  };

  it('puts a fermata at that position on every track, and a second press clears every one', () => {
    const doc = withPiano();

    toggleFermata(doc, [ref(0, 2)], medium);
    expect(fermatas(doc, 0)).toEqual([null, null, 'medium', null]);
    expect(fermatas(doc, 1)).toEqual([null, null, 'medium', null]);

    toggleFermata(doc, [ref(0, 2)], medium);
    expect(fermatas(doc, 0)).toEqual([null, null, null, null]);
    expect(fermatas(doc, 1)).toEqual([null, null, null, null]);
  });

  it('reads the position on every track, so one on another track alone does not make the press clear', () => {
    const doc = withPiano();
    doc.tracks[1].staves[0].bars[0].voices[0].beats[2].effects.fermata = { ...medium };

    toggleFermata(doc, [ref(0, 2)], medium);

    expect(fermatas(doc, 0)[2]).toBe('medium');
    expect(fermatas(doc, 1)[2]).toBe('medium');
  });

  it('finds the position by tick, and gives nothing to a staff with no beat starting there', () => {
    // The piano's bar is two halves: its second beat starts at 1920, the guitar's third beat's tick,
    // and nothing of the piano's starts at 960, the guitar's second.
    const doc = withPiano();
    doc.tracks[1].staves[0].bars[0].voices[0].beats = [createRestBeat(2), createRestBeat(2)];

    toggleFermata(doc, [ref(0, 2)], medium);
    toggleFermata(doc, [ref(0, 1)], medium);

    expect(fermatas(doc, 0)).toEqual([null, 'medium', 'medium', null]);
    expect(fermatas(doc, 1)).toEqual([null, 'medium']);
  });

  it('leaves a generated track alone', () => {
    const doc = withPiano();
    doc.tracks[1].generated = { progressionId: 'p', progressionName: 'Verse', source: { kind: 'revision', revision: 1 } };

    toggleFermata(doc, [ref(0, 0)], medium);

    expect(fermatas(doc, 1)).toEqual([null, null, null, null]);
  });

  describe('with a grace at the position', () => {
    // alphaTab files a fermata by the tick a beat plays at and hands it to every later beat there without
    // one (`Voice.finish` ~3294, `MasterBar.getFermata` ~2728). A grace in front of the beat at the
    // position plays there too, so it takes the fermata on the way in - and a clear that skipped it left
    // its copy, which then spread back to every track.
    let mapper: ScoreDocMapperService;

    beforeEach(() => {
      TestBed.configureTestingModule({});
      mapper = TestBed.inject(ScoreDocMapperService);
    });

    /** The guitar's quarters, and a piano bar with a grace of `kind` in front of its second quarter. */
    const withGrace = (kind: 'onBeat' | 'beforeBeat'): ScoreDoc => {
      const doc = withPiano();
      const piano = doc.tracks[1].staves[0].bars[0].voices[0].beats;
      piano.splice(1, 0, createRestBeat(8));
      piano[1].effects.grace = kind;
      piano[1].isRest = false;
      piano[1].notes = [{ pitch: { kind: 'pitched', noteValue: 2, octave: 4 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
      withNote(doc, 0, 1);
      return doc;
    };
    const roundTripped = (doc: ScoreDoc): ScoreDoc => mapper.toDoc(mapper.toScore(doc, new alphaTab.Settings()));

    for (const kind of ['onBeat', 'beforeBeat'] as const) {
      it(`writes and clears the ${kind} grace with its beat, so a save neither adds one nor leaves one`, () => {
        const doc = withGrace(kind);

        toggleFermata(doc, [ref(0, 1)], medium);
        expect(fermatas(doc, 1)).toEqual([null, 'medium', 'medium', null, null]);
        const saved = roundTripped(doc);
        expect([fermatas(saved, 0), fermatas(saved, 1)]).toEqual([fermatas(doc, 0), fermatas(doc, 1)]);

        toggleFermata(saved, [ref(0, 1)], medium);
        expect(fermatas(saved, 1)).toEqual([null, null, null, null, null]);
        const cleared = roundTripped(saved);
        expect([fermatas(cleared, 0), fermatas(cleared, 1)]).toEqual([[null, null, null, null], [null, null, null, null, null]]);
      });
    }

    it('reads only the beats at the position, so a grace\'s fermata alone does not make the press clear', () => {
      const doc = withGrace('onBeat');
      doc.tracks[1].staves[0].bars[0].voices[0].beats[1].effects.fermata = { ...medium };

      toggleFermata(doc, [ref(0, 1)], medium);

      expect(fermatas(doc, 0)[1]).toBe('medium');
    });

    it('finds no position for a grace alone', () => {
      const doc = withGrace('onBeat');

      expect(fermataPositionsOf(doc, [{ ...ref(0, 1), trackIndex: 1 }])).toEqual([]);
      expect(fermataRefusal(doc, [{ ...ref(0, 1), trackIndex: 1 }])).toMatch(/grace note has no bar position/i);
      expect(fermataRefusal(doc, [ref(0, 1)])).toBeNull();
    });
  });
});

describe('clearToRests, insertBeatAt and deleteBeats', () => {
  it('clears notes to rests and keeps each beat\'s value', () => {
    const doc = ComposerService.createEmptyScore();
    setBeatDurations(doc, [ref(0, 0)], 8, 0);
    withNote(doc, 0, 0);
    withNote(doc, 0, 2);

    clearToRests(doc, [ref(0, 0), ref(0, 1), ref(0, 2)]);

    expect(shape(doc)).toEqual(['r8', 'r8', 'r4', 'r4', 'r4']);
  });

  it('takes attacks off the rests it leaves, keeping the dynamic and the fermata', () => {
    // A rest has nothing to let ring, tap, slap, pop, pick or fade in; left on it, each is carried by a
    // cut and pasted back onto whatever note is written there later. The dynamic stands until the next
    // one, and a fermata belongs to the bar position, so both stay.
    const doc = ComposerService.createEmptyScore();
    withNote(doc, 0, 0);
    const beat = beats(doc)[0];
    beat.dynamics = 'pp';
    beat.effects = {
      ...beat.effects, isLetRing: true, isPalmMute: true, tap: true, slap: true, pop: true, fadeIn: true,
      pickStroke: 'down', vibrato: 'wide', brush: 'brushUp', crescendo: 'crescendo', fermata: { type: 'long', length: 1 }
    };

    clearToRests(doc, [ref(0, 0)]);

    expect(beats(doc)[0].effects).toEqual({ ...createDefaultBeatEffects(), fermata: { type: 'long', length: 1 } });
    expect(beats(doc)[0].dynamics).toBe('pp');
    expect(beats(doc)[0].isRest).toBeTrue();
  });

  it('removes a grace it clears, which takes no room and would lead a rest into its beat', () => {
    const doc = ComposerService.createEmptyScore();
    beats(doc).splice(1, 0, createRestBeat(8));
    withNote(doc, 0, 1);
    beats(doc)[1].effects.grace = 'beforeBeat';

    clearToRests(doc, [ref(0, 0), ref(0, 1)]);

    expect(shape(doc)).toEqual(['r4', 'r4', 'r4', 'r4']);
    expect(beats(doc).every(entry => entry.effects.grace === 'none')).toBeTrue();
  });

  it('inserts a beat in front of a grace run, not between the graces and the beat they lead into', () => {
    const doc = ComposerService.createEmptyScore();
    beats(doc).splice(1, 0, createRestBeat(8));
    withNote(doc, 0, 1);
    withNote(doc, 0, 2);
    beats(doc)[1].effects.grace = 'onBeat';

    insertBeatAt(doc, ref(0, 2), 8, 0);

    expect(beats(doc).map(entry => `${entry.effects.grace === 'none' ? '' : 'g'}${entry.isRest ? 'r' : 'n'}${entry.duration}`))
      .toEqual(['r4', 'r8', 'gn8', 'n4', 'r4', 'r4']);
  });

  it('inserts a rest in front of a beat and leaves the bar over', () => {
    const doc = ComposerService.createEmptyScore();
    withNote(doc, 0, 0);

    insertBeatAt(doc, ref(0, 0), 8, 1);

    expect(shape(doc)).toEqual(['r8.', 'n4', 'r4', 'r4', 'r4']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'over', ticks: 720 });
  });

  it('deletes beats, moves the later ones earlier, and fills the bar at its end', () => {
    const doc = ComposerService.createEmptyScore();
    withNote(doc, 0, 2);

    deleteBeats(doc, [ref(0, 0), ref(0, 1)]);

    expect(shape(doc)).toEqual(['n4', 'r4', 'r2']);
  });

  it('fills a bar whose every beat was deleted', () => {
    const doc = ComposerService.createEmptyScore();

    deleteBeats(doc, [0, 1, 2, 3].map(index => ref(0, index)));

    expect(shape(doc)).toEqual(['r1']);
  });
});

describe('a fermata through an edit that moves beats', () => {
  // alphaTab finishes tracks in order and files a beat's fermata on the master bar at the tick the beat starts
  // at, handing it to every beat finished later at that tick without one (`Voice.finish` ~3294,
  // `MasterBar.addFermata` ~2705, `MasterBar.getFermata` ~2728). So when an edit on an early track moves a
  // fermata beat to a tick where a later track has a beat, that beat takes the fermata on save. A fermata
  // stays at its bar position instead: the beat that moved away loses it, and whatever now starts there takes it.
  let mapper: ScoreDocMapperService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    mapper = TestBed.inject(ScoreDocMapperService);
  });

  const F = 'medium';
  const fermatas = (doc: ScoreDoc): (string | null)[][] =>
    doc.tracks.map(track => track.staves[0].bars[0].voices[0].beats.map(beat => beat.effects.fermata?.type ?? null));
  const saved = (doc: ScoreDoc): ScoreDoc => mapper.toDoc(mapper.toScore(doc, new alphaTab.Settings()));
  const onTrack = (trackIndex: number, beatIndex: number): BeatRef => ({ ...ref(0, beatIndex), trackIndex });

  /**
   * A guitar, a piano and an organ, each bar 0 a note on every quarter with a fermata on the second - or, with
   * `guitarQuarters`, that many quarters on the guitar and the fermata on the third quarter of every track.
   */
  const threeTracks = (guitarQuarters = 4): ScoreDoc => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    doc.tracks.push(ComposerService.createTrack('Organ', 'org', 16, false, doc.masterBars));
    while (beats(doc).length < guitarQuarters) beats(doc).push(createRestBeat(4));
    const at = guitarQuarters > 4 ? 2 : 1;
    doc.tracks.forEach((track, trackIndex) => {
      track.staves[0].bars[0].voices[0].beats.forEach((beat, index) => {
        beat.isRest = false;
        beat.notes = [{
          pitch: trackIndex === 0 ? { kind: 'fretted', string: 1, fret: 0 } : { kind: 'pitched', noteValue: 0, octave: 4 },
          isTied: false, accidental: 'auto', effects: createDefaultNoteEffects()
        }];
        if (index === at) beat.effects.fermata = { type: 'medium', length: 1 };
      });
    });
    return doc;
  };

  it('keeps it at its position when a beat before it grows into the note that holds it', () => {
    const doc = threeTracks();

    setBeatDurations(doc, [ref(0, 0)], 2, 0);

    // The half spans the second quarter's tick, so the guitar has no beat there; the quarter that moved to 1920
    // is at a position with no fermata.
    expect(fermatas(doc)).toEqual([[null, null, null, null], [null, F, null, null], [null, F, null, null]]);
    expect(fermatas(saved(doc))).toEqual(fermatas(doc));
  });

  it('keeps it at its position when a dot blocked by the note that holds it moves that note', () => {
    const doc = threeTracks();

    setBeatDots(doc, [ref(0, 0)], 1);

    expect(fermatas(doc)).toEqual([[null, null, null, null], [null, F, null, null], [null, F, null, null]]);
    expect(fermatas(saved(doc))).toEqual(fermatas(doc));
  });

  it('gives it to the beat an insert moves onto its position', () => {
    const doc = threeTracks();

    insertBeatAt(doc, ref(0, 0), 4, 0);

    expect(fermatas(doc)).toEqual([[null, F, null, null, null], [null, F, null, null], [null, F, null, null]]);
    expect(fermatas(saved(doc))).toEqual(fermatas(doc));
  });

  it('gives it to the beat a delete moves onto its position', () => {
    const doc = threeTracks();

    deleteBeats(doc, [ref(0, 0)]);

    expect(fermatas(doc)).toEqual([[null, F, null, null], [null, F, null, null], [null, F, null, null]]);
    expect(fermatas(saved(doc))).toEqual(fermatas(doc));
  });

  it('gives it to the beat that moves onto its position when a beat in a bar already over becomes a grace', () => {
    const doc = threeTracks(5);

    setGrace(doc, [ref(0, 0)], 'beforeBeat');

    // No rest fills the grace's room, since the bar was a quarter over, so every later beat moves a quarter earlier.
    expect(fermatas(doc)).toEqual([[null, null, null, F, null], [null, null, F, null], [null, null, F, null]]);
    expect(fermatas(saved(doc))).toEqual(fermatas(doc));
  });

  it('keeps it at its position when the edit is on the last track, which would save cleanly anyway', () => {
    const doc = threeTracks();

    setBeatDurations(doc, [onTrack(2, 0)], 2, 0);

    expect(fermatas(doc)).toEqual([[null, F, null, null], [null, F, null, null], [null, null, null, null]]);
    expect(fermatas(saved(doc))).toEqual(fermatas(doc));
  });
});
