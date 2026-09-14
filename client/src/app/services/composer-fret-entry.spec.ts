import { TestBed } from '@angular/core/testing';

import { ComposerService } from './composer.service';
import { FretDigitEntry } from './composer-fret-entry';

describe('FretDigitEntry', () => {
  let composer: ComposerService;
  let now: number;
  let auditioned: number[];
  let entry: FretDigitEntry;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    composer = TestBed.inject(ComposerService);
    now = 1000;
    auditioned = [];
    entry = new FretDigitEntry(composer, () => now, midi => auditioned.push(midi));
    composer.setCursor({ barIndex: 0, beatIndex: 0, stringIndex: 0 });
  });

  const beats = () => composer.doc.tracks[0].staves[0].bars[0].voices[0].beats;
  const fretAt = (index: number): number | null => {
    const pitch = beats()[index].notes[0]?.pitch;
    return pitch?.kind === 'fretted' ? pitch.fret : null;
  };

  it('makes "1" then "2" fret 12 on one beat, and one undo takes it all back', () => {
    entry.type(1);
    now += 300;
    entry.type(2);

    expect(fretAt(0)).toBe(12);
    expect(fretAt(1)).toBeNull();
    expect(composer.state.cursor.beatIndex).toBe(1);

    composer.undo();
    expect(beats()[0].isRest).toBeTrue();
    expect(composer.state.canUndo).toBeFalse();
  });

  it('starts a new note when the number would leave the fretboard', () => {
    entry.type(3);
    entry.type(5);

    expect([fretAt(0), fretAt(1)]).toEqual([3, 5]);
  });

  it('starts a new note once the window has passed', () => {
    entry.type(1);
    now += 900;
    entry.type(2);

    expect([fretAt(0), fretAt(1)]).toEqual([1, 2]);
  });

  it('starts a new note when the caret has moved since the first digit', () => {
    entry.type(1);
    composer.moveCursor({ kind: 'beat', delta: 1 });
    entry.type(2);

    expect([fretAt(0), fretAt(1), fretAt(2)]).toEqual([1, null, 2]);
  });

  it('auditions each fret it writes, capo included', () => {
    composer.setStaffNumber('capo', 2);
    entry.type(1);
    entry.type(2);

    // String 1 is E4, 64: fret 1 under a capo at 2 is 67, fret 12 is 78.
    expect(auditioned).toEqual([67, 78]);
  });

  it('writes nothing on a pitched staff', () => {
    composer.addTrack('Piano', 0, false);
    composer.setCursor({ trackIndex: 1 });
    const before = JSON.stringify(composer.doc);

    entry.type(5);

    expect(JSON.stringify(composer.doc)).toBe(before);
  });
});
