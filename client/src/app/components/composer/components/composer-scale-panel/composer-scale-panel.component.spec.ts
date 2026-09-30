import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComposerScalePanelComponent } from './composer-scale-panel.component';
import { HighlightConfig } from '../../../../models/alpha-tab.model';
import { MusicTheoryService } from '../../../../services/music-theory.service';

describe('ComposerScalePanelComponent', () => {
  let fixture: ComponentFixture<ComposerScalePanelComponent>;
  let panel: ComposerScalePanelComponent;
  let said: HighlightConfig[];
  let firstOpenings: number;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerScalePanelComponent] }).compileComponents();
    fixture = TestBed.createComponent(ComposerScalePanelComponent);
    panel = fixture.componentInstance;
    said = [];
    firstOpenings = 0;
    panel.highlightChange.subscribe(config => said.push(config));
    panel.firstOpened.subscribe(() => firstOpenings++);
    fixture.detectChanges();
  });

  /** The first scale in the catalogue, as `MusicTheoryService` offers it. */
  const firstScale = () => {
    const item = TestBed.inject(MusicTheoryService).getUnifiedCategories()[0].items[0];
    return { id: item.id, name: item.name, intervals: item.intervals, type: item.type };
  };

  it("offers the music theory catalogue's scales and chords, grouped as it groups them", () => {
    const categories = TestBed.inject(MusicTheoryService).getUnifiedCategories();

    expect(panel.groups.map(group => group.name)).toEqual(categories.map(category => category.name));
  });

  it('says the highlight as a HighlightConfig once it is switched on and a scale is chosen, and says it off again', () => {
    const scale = firstScale();
    panel.enabled = true;
    panel.rootNote = 9;
    panel.scaleId = scale.id;
    panel.changed();

    expect(said.at(-1)).toEqual({ enabled: true, rootNote: 9, intervals: scale.intervals, name: `A ${scale.name}`, type: scale.type });

    panel.enabled = false;
    panel.changed();
    expect(said.at(-1)?.enabled).toBeFalse();
  });

  it('says nothing is highlighted while it is on with no scale chosen', () => {
    panel.enabled = true;
    panel.changed();

    expect(said.at(-1)?.enabled).toBeFalse();
  });

  it('reports its first opening once, for the page to turn note bounds on', () => {
    panel.toggleOpen();
    panel.toggleOpen();
    panel.toggleOpen();

    expect(firstOpenings).toBe(1);
  });

  it('closes on Escape, and keeps the Escape from the page', () => {
    panel.toggleOpen();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    const stop = spyOn(escape, 'stopPropagation').and.callThrough();

    panel.onKey(escape);

    expect(panel.open).toBeFalse();
    expect(stop).toHaveBeenCalled();
  });
});
