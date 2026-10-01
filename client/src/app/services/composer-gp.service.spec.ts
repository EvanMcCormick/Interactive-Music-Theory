import { ErrorHandler } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTexService } from './alpha-tex.service';
import { ComposerGpService, GpFile, GpOriginal } from './composer-gp.service';
import { ComposerService } from './composer.service';
import { ASKING_PAGE_COMMANDS } from './composer-edit-intent';
import { ScoreDocMapperService } from './score-doc-mapper.service';

/**
 * The Original state: the `.gp` file the page is showing as alphaTab read it, and the command waiting on the
 * conversion prompt.
 *
 * Non-null means the page is in Original; null means Composition. Nothing else in the composer keeps this, so
 * `ComposerService`, near the 1000-line cap, gains nothing.
 */
describe('ComposerGpService', () => {
  let service: ComposerGpService;
  let composer: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerGpService);
    composer = TestBed.inject(ComposerService);
  });

  /** A one-bar score titled `entryId`, as its file. */
  function file(entryId: string): GpFile {
    const score = new alphaTab.model.Score();
    score.title = entryId;
    return { entryId, fileName: `${entryId}.gp`, bytes: new ArrayBuffer(4), score };
  }

  it('starts in Composition, with no original', () => {
    expect(service.isOriginal).toBe(false);
    expect(service.original).toBeNull();
  });

  it('opening a file puts the page in Original and publishes it', () => {
    const seen: Array<GpOriginal | null> = [];
    service.getState().subscribe(value => seen.push(value));

    service.open(file('a'));

    expect(service.isOriginal).toBe(true);
    expect(service.original?.entryId).toBe('a');
    expect(seen.map(value => value?.entryId ?? null)).toEqual([null, 'a']);
  });

  it('measures what converting the file would change as it opens', () => {
    const credited = file('a');
    credited.score.copyright = '2026';

    service.open(credited);

    expect(service.original?.loss.map(item => item.id)).toEqual(['credits']);
  });

  it('still opens a file whose loss it cannot measure, and says that it could not', () => {
    spyOn(TestBed.inject(ScoreDocMapperService), 'toDoc').and.throwError('a model this mapper has not met');
    const handled = spyOn(TestBed.inject(ErrorHandler), 'handleError');

    service.open(file('a'));

    expect(service.isOriginal).toBe(true);
    expect(service.original?.loss.map(item => [item.id, item.group])).toEqual([['unmeasured', 'conversion']]);
    expect((handled.calls.mostRecent().args[0] as Error).message).toContain('has not met');
  });

  it('opening another file replaces the first, rather than stacking', () => {
    service.open(file('a'));
    service.open(file('b'));

    expect(service.original?.entryId).toBe('b');
  });

  it('clearing goes back to Composition and drops the bytes', () => {
    service.open(file('a'));

    service.clear();

    expect(service.isOriginal).toBe(false);
    expect(service.original).toBeNull();
  });

  it('goes back to Composition when another composition opens', () => {
    service.open(file('a'));

    composer.reset();

    expect(service.isOriginal).toBe(false);
  });

  it('stays in Original through what does not open a composition: a caret move', () => {
    service.open(file('a'));

    composer.setCursor({ beatIndex: 1 });

    expect(service.isOriginal).toBe(true);
  });

  /**
   * The caret over the file. In Original the composition under the page is the empty one no one sees, so a caret held there
   * was clamped to its bar 1: the file keeps its own, and the composer's caret commands are lent to it.
   */
  describe("the file's caret", () => {
    /** A guitar file of three bars, the second of two beats, and a keyboard track of one bar. */
    function band(): GpFile {
      const source = ['\\track "Guitar"', '3.3.4 3.3.4 3.3.4 3.3.4 | 5.2.2 7.2.2 | 3.3.1 |', '\\track "Keys"', 'c4.1 | c4.1 | c4.1 |'].join('\n');
      const score = TestBed.inject(AlphaTexService).parse(source).score;
      if (!score) throw new Error('the file did not parse');
      return { entryId: 'band', fileName: 'Band.gp', bytes: new ArrayBuffer(4), score };
    }

    it('starts at the start of the file, and is null in Composition', () => {
      expect(service.caret).toBeNull();

      service.open(band());

      expect(service.caret).toEqual({ cursor: { trackIndex: 0, staffIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0, stringIndex: 0 }, anchor: null });
    });

    it("takes the composer's caret commands in Original, against the file rather than the composition under it", () => {
      service.open(band());
      const under = composer.state.cursor;

      composer.setCursor({ barIndex: 2, stringIndex: 3 });

      expect(service.caret?.cursor).toEqual(jasmine.objectContaining({ barIndex: 2, stringIndex: 3 }));
      expect(composer.state.cursor).withContext('the empty composition under the file').toBe(under);
    });

    it('holds a caret in range of the file, as the composition clamps its own', () => {
      service.open(band());

      composer.setCursor({ barIndex: 9, beatIndex: 9 });

      expect(service.caret?.cursor).toEqual(jasmine.objectContaining({ barIndex: 2, beatIndex: 0 }));
    });

    it('moves by the keys over the file, and extends a range there', () => {
      service.open(band());
      composer.setCursor({ barIndex: 1 });

      composer.moveCursor({ kind: 'beat', delta: 1 });
      expect(service.caret?.cursor).toEqual(jasmine.objectContaining({ barIndex: 1, beatIndex: 1 }));

      composer.moveCursor({ kind: 'beat', delta: 1 }, true);
      expect(service.caret?.cursor).toEqual(jasmine.objectContaining({ barIndex: 2, beatIndex: 0 }));
      expect(service.caret?.anchor).toEqual(jasmine.objectContaining({ barIndex: 1, beatIndex: 1 }));

      composer.extendSelectionTo({ trackIndex: 1, barIndex: 0, stringIndex: null });
      expect(service.caret?.cursor).toEqual(jasmine.objectContaining({ trackIndex: 1, barIndex: 0 }));

      composer.setCursor({});
      expect(service.caret?.anchor).withContext('a plain move drops the range').toBeNull();
    });

    it('passes over the tracks it is told to on a track move, as the composition does', () => {
      service.open(band());
      service.passOverTracks(index => index === 1);

      composer.moveCursor({ kind: 'track', delta: 1 });

      expect(service.caret?.cursor.trackIndex).toBe(0);
    });

    it('selects every beat of the caret\'s staff in the file', () => {
      service.open(band());

      composer.selectAllInTrack();

      expect(service.caret?.anchor).toEqual(jasmine.objectContaining({ barIndex: 0, beatIndex: 0 }));
      expect(service.caret?.cursor).toEqual(jasmine.objectContaining({ barIndex: 2, beatIndex: 0 }));
    });

    it('takes a press as it is when the file could not be read as a document, and moves by no key', () => {
      spyOn(TestBed.inject(ScoreDocMapperService), 'toDoc').and.throwError('a model this mapper has not met');
      spyOn(TestBed.inject(ErrorHandler), 'handleError');
      service.open(band());

      composer.setCursor({ barIndex: 2 });
      composer.moveCursor({ kind: 'beat', delta: 1 });

      expect(service.caret?.cursor.barIndex).toBe(2);
      expect(service.caret?.cursor.beatIndex).toBe(0);
    });

    it("gives the composer its caret back on leaving Original", () => {
      service.open(band());
      composer.setCursor({ barIndex: 2 });

      service.clear();
      composer.setCursor({ barIndex: 1 });

      expect(service.caret).toBeNull();
      expect(composer.state.cursor.barIndex).toBe(1);
    });

    it('starts again at the start of a second file', () => {
      service.open(band());
      composer.setCursor({ barIndex: 2 });

      service.open(band());

      expect(service.caret?.cursor.barIndex).toBe(0);
    });
  });

  describe('requestEdit', () => {
    it('runs a command at once in Composition', () => {
      let ran = 0;

      service.requestEdit('hammerOn', 'Hammer-on', () => ran++);

      expect(ran).toBe(1);
      expect(service.request).toBeNull();
    });

    it('runs a command that does not change the document at once in Original', () => {
      service.open(file('a'));
      let ran = 0;

      service.requestEdit('nextBeat', 'Next beat', () => ran++);

      expect(ran).toBe(1);
      expect(service.request).toBeNull();
    });

    it('holds a writing command in Original, for the prompt', () => {
      service.open(file('a'));
      let ran = 0;

      service.requestEdit(ASKING_PAGE_COMMANDS.texApply, 'Applying the alphaTex draft', () => ran++);

      expect(ran).toBe(0);
      expect(service.request?.label).toBe('Applying the alphaTex draft');
    });

    it('keeps the first command while one is waiting, and drops a second', () => {
      service.open(file('a'));
      let ran = '';
      service.requestEdit('hammerOn', 'Hammer-on', () => (ran = 'first'));

      service.requestEdit(ASKING_PAGE_COMMANDS.progressionTrack, 'Sending the progression', () => (ran = 'second'));
      service.request?.run();

      expect(service.request?.label).toBe('Hammer-on');
      expect(ran).toBe('first');
    });

    it('drops the command on Cancel, and on leaving Original', () => {
      service.open(file('a'));
      service.requestEdit('hammerOn', 'Hammer-on', () => undefined);

      service.cancelEdit();
      expect(service.request).toBeNull();

      service.requestEdit('hammerOn', 'Hammer-on', () => undefined);
      service.clear();
      expect(service.request).toBeNull();
    });
  });
});
