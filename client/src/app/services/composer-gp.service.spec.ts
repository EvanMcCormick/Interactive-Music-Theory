import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { ComposerGpService, GpOriginal } from './composer-gp.service';

/**
 * The Original state: the `.gp` file the page is showing as alphaTab read it.
 *
 * Non-null means the page is in Original; null means Composition. Nothing else in the composer keeps this, so
 * `ComposerService` - 861 lines against the 1000-line cap - gains nothing.
 */
describe('ComposerGpService', () => {
  let service: ComposerGpService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerGpService);
  });

  function original(entryId: string): GpOriginal {
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

    service.open(original('a'));

    expect(service.isOriginal).toBe(true);
    expect(service.original?.entryId).toBe('a');
    expect(seen.map(value => value?.entryId ?? null)).toEqual([null, 'a']);
  });

  it('opening another file replaces the first, rather than stacking', () => {
    service.open(original('a'));
    service.open(original('b'));

    expect(service.original?.entryId).toBe('b');
  });

  it('clearing goes back to Composition and drops the bytes', () => {
    service.open(original('a'));

    service.clear();

    expect(service.isOriginal).toBe(false);
    expect(service.original).toBeNull();
  });
});
