import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTabService } from './alpha-tab.service';

describe('AlphaTabService before an api exists', () => {
  it('registers mouse-move, mouse-up and post-render handlers, draws and clears a highlight, and seeks, without throwing', () => {
    TestBed.configureTestingModule({});
    const service = TestBed.inject(AlphaTabService);
    const beat = new alphaTab.model.Beat();

    expect(() => {
      service.onBeatMouseMove(() => undefined);
      service.onBeatMouseUp(() => undefined);
      service.onPostRenderFinished(() => undefined);
      service.highlightRange(beat, beat);
      service.clearHighlight();
      service.seekToBeat(beat);
    }).not.toThrow();
  });
});
