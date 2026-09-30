import { ErrorHandler } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { ComposerGpService, GpFile, GpOriginal } from './composer-gp.service';
import { ComposerService } from './composer.service';
import { ASKING_PAGE_COMMANDS } from './composer-edit-intent';
import { ScoreDocMapperService } from './score-doc-mapper.service';

/**
 * The Original state: the `.gp` file the page is showing as alphaTab read it, and the command waiting on the
 * conversion prompt.
 *
 * Non-null means the page is in Original; null means Composition. Nothing else in the composer keeps this, so
 * `ComposerService` - 861 lines against the 1000-line cap - gains nothing.
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
