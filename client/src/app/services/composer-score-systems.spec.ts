import * as alphaTab from '@coderline/alphatab';

import { ComposerService } from './composer.service';
import { StaffSlot, staffSlotsOf } from './composer-score-interaction';
import {
  BoundsLookupShape,
  SystemBands,
  highlightBeatsOf,
  measuredStaffOfSlot,
  slotIndexAt,
  systemBandsOf,
  systemIndexAt
} from './composer-score-systems';
import { ScoreDocMapperService } from './score-doc-mapper.service';
import { insertBarInto } from './score-structure';
import { StaffHitTestService } from './staff-hit-test.service';

/** A guitar (notation and tablature) and a piano (notation): three staves per system. */
const slots: StaffSlot[] = [
  { trackIndex: 0, staffIndex: 0, kind: 'notation' },
  { trackIndex: 0, staffIndex: 0, kind: 'tab' },
  { trackIndex: 1, staffIndex: 0, kind: 'notation' }
];

/** Two systems 300px tall, each drawing the three staves above. */
const systemAt = (top: number): SystemBands => ({
  top,
  bottom: top + 300,
  staves: [
    { trackIndex: 0, staffIndex: 0, top: top + 20, bottom: top + 80 },
    { trackIndex: 0, staffIndex: 0, top: top + 80, bottom: top + 150 },
    { trackIndex: 1, staffIndex: 0, top: top + 150, bottom: top + 220 }
  ]
});
const systems: SystemBands[] = [systemAt(0), systemAt(300)];

describe('systemIndexAt', () => {
  it('finds the system whose band holds a y, or none past the last', () => {
    expect(systemIndexAt(systems, 10)).toBe(0);
    expect(systemIndexAt(systems, 350)).toBe(1);
    expect(systemIndexAt(systems, 700)).toBeNull();
    expect(systemIndexAt([], 10)).toBeNull();
  });
});

describe('slotIndexAt', () => {
  it('names a staff on the second system by its own slot, not by its place on the page', () => {
    // Counting staves down the page, system 2's tablature is the fifth: slots[4], which does not exist.
    expect(slotIndexAt(systems[1], 415, slots)).toBe(1);
    expect(slotIndexAt(systems[1], 350, slots)).toBe(0);
    expect(slotIndexAt(systems[1], 485, slots)).toBe(2);
  });

  it('takes the nearest stave for a y in a gap between bands', () => {
    expect(slotIndexAt(systems[1], 540, slots)).toBe(2);
  });

  it('names no slot for a stave the document does not draw', () => {
    const notationOnly: StaffSlot[] = [slots[0], slots[2]];

    expect(slotIndexAt(systems[1], 415, notationOnly)).toBeNull();
  });
});

describe('measuredStaffOfSlot', () => {
  it('finds the measured staff drawing a slot on the given system', () => {
    // Middle lines of every staff measured on the page, both systems attached.
    const measured = [50, 115, 185, 350, 415, 485];

    expect(measuredStaffOfSlot(systems[1], measured, 1, slots)).toBe(4);
    expect(measuredStaffOfSlot(systems[0], measured, 1, slots)).toBe(1);
  });

  it('finds it when lazy loading has attached only that system', () => {
    expect(measuredStaffOfSlot(systems[1], [350, 415, 485], 2, slots)).toBe(2);
  });

  it('finds none when the system is not attached', () => {
    expect(measuredStaffOfSlot(systems[1], [50, 115, 185], 1, slots)).toBeNull();
  });
});

describe('systemBandsOf', () => {
  it('reads each system\'s staves from its first bar\'s beats, top to bottom', () => {
    // As `BoundsLookup.fromJson` leaves it on the worker path: `BarBounds.bar` is never set.
    const beatOn = (trackIndex: number): { beat: { voice: { bar: { staff: { index: number; track: { index: number } } } } } } =>
      ({ beat: { voice: { bar: { staff: { index: 0, track: { index: trackIndex } } } } } });
    const lookup: BoundsLookupShape = {
      staffSystems: [
        {
          realBounds: { y: 0, h: 300 },
          bars: [
            {
              bars: [
                { realBounds: { y: 80, h: 70 }, beats: [beatOn(0)] },
                { realBounds: { y: 20, h: 60 }, beats: [beatOn(0)] },
                { realBounds: { y: 150, h: 70 }, beats: [beatOn(1)] }
              ]
            }
          ]
        }
      ]
    };

    expect(systemBandsOf(lookup)).toEqual([systemAt(0)]);
  });

  it('reads no staves for a system with no bars', () => {
    expect(systemBandsOf({ staffSystems: [{ realBounds: { y: 0, h: 300 }, bars: [] }] })).toEqual([
      { top: 0, bottom: 300, staves: [] }
    ]);
  });
});

describe('highlightBeatsOf', () => {
  const first = new alphaTab.model.Beat();
  const last = new alphaTab.model.Beat();
  const lookupOf = (known: alphaTab.model.Beat[]): { findBeat(beat: alphaTab.model.Beat): object | null } => ({
    findBeat: beat => (known.includes(beat) ? {} : null)
  });

  it('draws a range whose ends both have bounds', () => {
    expect(highlightBeatsOf(first, last, lookupOf([first, last]))).toEqual({ first, last });
  });

  it('draws nothing while a render is in flight and the bounds are still the last render\'s', () => {
    expect(highlightBeatsOf(first, last, lookupOf([first]))).toBeNull();
    expect(highlightBeatsOf(first, last, lookupOf([last]))).toBeNull();
    expect(highlightBeatsOf(first, last, null)).toBeNull();
  });

  it('draws nothing without both ends', () => {
    expect(highlightBeatsOf(undefined, last, lookupOf([first, last]))).toBeNull();
    expect(highlightBeatsOf(first, undefined, lookupOf([first, last]))).toBeNull();
  });
});

describe('staff systems on a real engraving', () => {
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    host?.remove();
    host = null;
  });

  /**
   * Engraves `doc` as the composer does, page layout, with alphaTab's SVG renderer on this thread - no workers,
   * no lazy loading, no fonts to wait for - and attaches each partial as `BrowserUiFacade` does: an absolutely
   * placed child of `.at-surface`.
   */
  function engrave(doc: ReturnType<typeof ComposerService.createEmptyScore>, width: number): alphaTab.rendering.BoundsLookup | null {
    const settings = new alphaTab.Settings();
    settings.core.engine = 'svg';
    settings.core.useWorkers = false;
    settings.core.enableLazyLoading = false;
    settings.display.layoutMode = alphaTab.LayoutMode.Page;
    const score = new ScoreDocMapperService().toScore(doc, settings);

    host = document.createElement('div');
    host.style.cssText = `position: absolute; left: 0; top: 0; width: ${width}px;`;
    const surface = document.createElement('div');
    surface.className = 'at-surface';
    surface.style.position = 'relative';
    host.appendChild(surface);
    document.body.appendChild(host);

    const renderer = new alphaTab.rendering.ScoreRenderer(settings);
    renderer.width = width;
    renderer.partialRenderFinished.on(result => {
      const partial = document.createElement('div');
      partial.style.cssText = `position: absolute; left: ${result.x}px; top: ${result.y}px;`;
      partial.innerHTML = String(result.renderResult);
      surface.appendChild(partial);
    });
    renderer.renderScore(score, score.tracks.map((_, index) => index));
    return renderer.boundsLookup;
  }

  it('resolves a staff on the second system to its own slot, measured and under the pointer', () => {
    const doc = ComposerService.createEmptyScore();
    for (let bar = 0; bar < 12; bar++) insertBarInto(doc, doc.masterBars.length);
    const lookup = engrave(doc, 500);
    const hitTest = new StaffHitTestService();
    const docSlots = staffSlotsOf(doc);

    expect(lookup).not.toBeNull();
    if (!lookup || !host) return;
    const bands = systemBandsOf(lookup);
    const staves = hitTest.allStaves(host);
    const centres = hitTest.staffCentresIn(host, staves);

    expect(bands.length).toBeGreaterThan(1);
    expect(staves.length).toBe(bands.length * docSlots.length);
    expect(centres.length).toBe(staves.length);

    // System 2's tablature, found from its slot, is the page's fourth staff.
    const tab = measuredStaffOfSlot(bands[1], centres, 1, docSlots);
    expect(tab).toBe(docSlots.length + 1);
    if (tab === null) return;
    expect(slotIndexAt(bands[1], centres[tab], docSlots)).toBe(1);

    // A pointer on that staff's third string.
    const lines = staves[tab];
    const box = lines.surface.getBoundingClientRect();
    const clientX = box.left + box.width / 2;
    const clientY = box.top + lines.lineY[2];
    const origin = hitTest.surfaceOriginOf(host);

    expect(hitTest.staffIndexAt(host, clientX, clientY, staves)).toBe(tab);
    expect(origin).not.toBeNull();
    if (!origin) return;
    const y = clientY - origin.top;
    expect(systemIndexAt(bands, y)).toBe(1);
    expect(slotIndexAt(bands[1], y, docSlots)).toBe(1);
  });
});
