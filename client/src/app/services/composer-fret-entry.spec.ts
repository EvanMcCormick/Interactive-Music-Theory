import { TestBed } from '@angular/core/testing';

import { ComposerState, StaffDoc } from '../models/composer.model';
import { ComposerService } from './composer.service';
import { FretDigitEntry } from './composer-fret-entry';
import { stateOf } from './composer.service.spec-helper';

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

  it('starts a new note when the document changed between digits, as an undo changes it', () => {
    entry.type(1);
    composer.undo();
    entry.type(2);

    expect(beats()[0].isRest).toBeTrue();
    expect(fretAt(1)).toBe(2);
  });

  it('never continues a leading 0, so "0" then "5" are two notes', () => {
    entry.type(0);
    entry.type(5);

    expect([fretAt(0), fretAt(1)]).toEqual([0, 5]);
  });

  it('auditions each fret it writes, capo included', () => {
    composer.setStaffNumber('capo', 2);
    entry.type(1);
    entry.type(2);

    // String 1 is E4, 64: fret 1 under a capo at 2 is 67, fret 12 is 78.
    expect(auditioned).toEqual([67, 78]);
  });

  it('refuses a number past the last fret in front of the capo, saying why, and sounds nothing for it', () => {
    composer.setStaffNumber('capo', 5);
    entry.type(2);
    now += 300;
    entry.type(0);

    expect(fretAt(0)).toBe(2);
    expect(fretAt(1)).toBeNull();
    expect(stateOf(composer).refusal).toBe('With the capo at 5, a fret runs from 0 to 19.');
    // String 1 is E4, 64: fret 2 under a capo at 5 is 71, and fret 20 was never written.
    expect(auditioned).toEqual([71]);
  });

  it('writes nothing on a pitched staff', () => {
    composer.addTrack('Piano', 0, false);
    composer.setCursor({ trackIndex: 1 });
    const before = JSON.stringify(composer.doc);

    entry.type(5);

    expect(JSON.stringify(composer.doc)).toBe(before);
  });
});

describe('FretDigitEntry over a refused write', () => {
  /**
   * A composer on one guitar staff whose writes the spec decides: an accepted write publishes a new document, as
   * `ComposerService` does, and a refused one keeps the document, as a refusal does.
   */
  class RefusingComposer {
    accepts = true;
    state: Pick<ComposerState, 'doc' | 'cursor'> = {
      doc: ComposerService.createEmptyScore(),
      cursor: { trackIndex: 0, staffIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0, stringIndex: 0 }
    };
    private readonly staff = this.state.doc.tracks[0].staves[0];

    staffAt(): StaffDoc {
      return this.staff;
    }

    setNoteAtCursor(): void {
      this.write();
    }

    retypeNote(): void {
      this.write();
    }

    private write(): void {
      if (this.accepts) this.state = { ...this.state, doc: structuredClone(this.state.doc) };
    }
  }

  let composer: RefusingComposer;
  let auditioned: number[];
  let entry: FretDigitEntry;

  beforeEach(() => {
    composer = new RefusingComposer();
    auditioned = [];
    entry = new FretDigitEntry(composer as unknown as ComposerService, () => 1000, midi => auditioned.push(midi));
  });

  it('sounds nothing for a first digit whose note was refused', () => {
    composer.accepts = false;

    entry.type(3);

    expect(auditioned).toEqual([]);
  });

  it('sounds nothing for a second digit whose retyped note was refused, having sounded the first', () => {
    entry.type(1);
    composer.accepts = false;
    entry.type(2);

    // String 1 is E4, 64: fret 1 is 65, and fret 12 was never written.
    expect(auditioned).toEqual([65]);
  });
});
