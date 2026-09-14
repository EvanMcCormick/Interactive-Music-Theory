import * as alphaTab from '@coderline/alphatab';

import { ComposerService } from './composer.service';
import { StaffSlot, staffSlotsOf } from './composer-score-interaction';
import {
  BoundsLookupShape,
  SystemBands,
  highlightBeatsOf,
  measuredStaffOfSlot,
  numberedSlotAt,
  pressSystemIndexOf,
  slotIndexAt,
  staveBandOfSlot,
  systemBandsOf,
  systemIndexAt,
  targetTrackBeat
} from './composer-score-systems';
import { ScoreDocMapperService } from './score-doc-mapper.service';
import { insertBarInto } from './score-structure';
import { StaffHitTestService } from './staff-hit-test.service';
import { createDefaultNoteEffects } from '../models/composer.model';

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
  it('finds the system whose band holds a y, or else the nearest, and none on a page with no systems', () => {
    expect(systemIndexAt(systems, 10)).toBe(0);
    expect(systemIndexAt(systems, 350)).toBe(1);
    expect(systemIndexAt(systems, 700)).toBe(1);
    expect(systemIndexAt(systems, -5)).toBe(0);
    // A system's band starts below the top of its partial, so a pointer can fall between two bands.
    expect(systemIndexAt([systemAt(0), systemAt(320)], 312)).toBe(1);
    expect(systemIndexAt([], 10)).toBeNull();
  });
});

describe('pressSystemIndexOf', () => {
  it('takes the system of the staff under the pointer, and the pointer\'s own only off every staff', () => {
    // A ledger line above system 2's first staff lies inside system 1's band.
    expect(pressSystemIndexOf(systems, 350, 295)).toBe(1);
    expect(pressSystemIndexOf(systems, null, 295)).toBe(0);
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

describe('numberedSlotAt and staveBandOfSlot', () => {
  /** The guitar's second band is a numbered staff here, in place of its tablature's rank. */
  const numberedSlots: StaffSlot[] = [
    { trackIndex: 0, staffIndex: 0, kind: 'notation' },
    { trackIndex: 0, staffIndex: 0, kind: 'numbered' },
    { trackIndex: 1, staffIndex: 0, kind: 'notation' }
  ];

  it('names the numbered staff whose band holds a y, on any system, and nothing on another band or outside every band', () => {
    expect(numberedSlotAt(systems[0], 100, numberedSlots)).toBe(1);
    expect(numberedSlotAt(systems[1], 400, numberedSlots)).toBe(1);
    expect(numberedSlotAt(systems[0], 50, numberedSlots)).toBeNull();
    // Below every band, where the nearest is the piano's notation, and just above the numbered band.
    expect(numberedSlotAt(systems[0], 250, numberedSlots)).toBeNull();
    expect(numberedSlotAt(systems[0], 79, slots)).toBeNull();
  });

  it('finds the band that draws a slot on a system, and none for a slot it does not draw', () => {
    expect(staveBandOfSlot(systems[1], 1, numberedSlots)).toEqual({ trackIndex: 0, staffIndex: 0, top: 380, bottom: 450 });
    expect(staveBandOfSlot(systems[0], 2, numberedSlots)).toEqual({ trackIndex: 1, staffIndex: 0, top: 150, bottom: 220 });
    expect(staveBandOfSlot(systems[0], 3, numberedSlots)).toBeNull();
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

describe('targetTrackBeat', () => {
  /** A bar's bounds on `trackIndex`, with `count` beats `step` pixels apart, as a render leaves them. */
  function barOn(masterBar: alphaTab.rendering.MasterBarBounds, trackIndex: number, top: number, count: number, step: number): alphaTab.model.Beat[] {
    const track = new alphaTab.model.Track();
    track.index = trackIndex;
    const staff = new alphaTab.model.Staff();
    staff.index = 0;
    staff.track = track;
    const bar = new alphaTab.model.Bar();
    bar.staff = staff;
    const voice = new alphaTab.model.Voice();
    voice.bar = bar;

    const bounds = new alphaTab.rendering.BarBounds();
    bounds.realBounds = new alphaTab.rendering.Bounds(0, top, count * step, 60);
    bounds.visualBounds = new alphaTab.rendering.Bounds(0, top, count * step, 60);
    masterBar.addBar(bounds);

    return Array.from({ length: count }, (_, index) => {
      const beat = new alphaTab.model.Beat();
      beat.index = index;
      beat.voice = voice;
      voice.beats.push(beat);
      const beatBounds = new alphaTab.rendering.BeatBounds();
      beatBounds.beat = beat;
      beatBounds.barBounds = bounds;
      beatBounds.realBounds = new alphaTab.rendering.Bounds(index * step, top, step, 60);
      beatBounds.visualBounds = new alphaTab.rendering.Bounds(index * step, top, step, 60);
      // Not `addBeat`, which reaches for a whole lookup this spec has no need of.
      bounds.beats.push(beatBounds);
      return beat;
    });
  }

  it('finds the beat on the track under the pointer, not the nearest beat on any track', () => {
    const masterBar = new alphaTab.rendering.MasterBarBounds();
    const eighths = barOn(masterBar, 0, 0, 8, 25);
    const quarters = barOn(masterBar, 1, 100, 4, 50);

    // At x 85, track 0's eighth at 75 is nearer than track 1's quarter at 50, and alphaTab's own search picks it.
    expect(masterBar.findBeatAtPos(85)).toBe(eighths[3]);
    expect(targetTrackBeat(masterBar, 85, 1, 0)).toBe(quarters[1]);
    expect(targetTrackBeat(masterBar, 85, 0, 0)).toBe(eighths[3]);
  });

  it('finds none for a track the master bar does not draw', () => {
    const masterBar = new alphaTab.rendering.MasterBarBounds();
    barOn(masterBar, 0, 0, 4, 50);

    expect(targetTrackBeat(masterBar, 60, 2, 0)).toBeNull();
    expect(targetTrackBeat(masterBar, 60, 0, 1)).toBeNull();
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
  function engrave(
    doc: ReturnType<typeof ComposerService.createEmptyScore>,
    width: number,
    errors: unknown[] = []
  ): alphaTab.rendering.BoundsLookup | null {
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
    // `renderScore` catches what the layout throws and reports it here; the composer's worker logs it and draws nothing.
    renderer.error.on(error => errors.push(error));
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

  it('puts a press on a ledger line above a later system\'s first staff on that staff\'s system, above where its band starts', () => {
    const doc = ComposerService.createEmptyScore();
    for (let bar = 0; bar < 16; bar++) insertBarInto(doc, doc.masterBars.length);
    const lookup = engrave(doc, 500);
    const hitTest = new StaffHitTestService();
    const docSlots = staffSlotsOf(doc);

    expect(lookup).not.toBeNull();
    if (!lookup || !host) return;
    const bands = systemBandsOf(lookup);
    const staves = hitTest.allStaves(host);
    const centres = hitTest.staffCentresIn(host, staves);
    const origin = hitTest.surfaceOriginOf(host);
    expect(bands.length).toBeGreaterThan(2);
    expect(origin).not.toBeNull();
    if (!origin) return;

    for (const systemIndex of [1, 2]) {
      // The system's notation staff, two line spacings above its top line.
      const notation = systemIndex * docSlots.length;
      const lines = staves[notation];
      const box = lines.surface.getBoundingClientRect();
      const clientX = box.left + box.width / 2;
      const clientY = box.top + lines.lineY[0] - 2 * lines.spacing;
      const y = clientY - origin.top;

      expect(y).withContext(`system ${systemIndex + 1}: the pointer is above its band`).toBeLessThan(bands[systemIndex].top);
      const index = hitTest.staffIndexAt(host, clientX, clientY, staves);
      expect(index).toBe(notation);
      if (index === null) continue;
      expect(pressSystemIndexOf(bands, centres[index], y)).toBe(systemIndex);
      expect(slotIndexAt(bands[systemIndex], centres[index], docSlots)).toBe(0);
    }
  });

  it('measures a slash staff as its one line, and ranks it and a numbered staff where alphaTab draws them', () => {
    const doc = ComposerService.createEmptyScore();
    Object.assign(doc.tracks[0].staves[0], { showSlash: true, showNumbered: true });
    const lookup = engrave(doc, 900);
    const hitTest = new StaffHitTestService();
    const docSlots = staffSlotsOf(doc);

    expect(lookup).not.toBeNull();
    if (!lookup || !host) return;
    const bands = systemBandsOf(lookup);
    const staves = hitTest.allStaves(host);
    const centres = hitTest.staffCentresIn(host, staves);

    expect(bands[0].staves.length).withContext('slash, notation, numbered and tablature each have a band').toBe(4);
    // A numbered staff draws no lines, so a system measures the slash staff's line, notation's five and tablature's six.
    expect(staves.slice(0, 3).map(staff => staff.lineY.length)).toEqual([1, 5, 6]);
    expect(centres.slice(0, 3).map(y => slotIndexAt(bands[0], y, docSlots))).toEqual([0, 1, 3]);
    expect(docSlots.map(slot => slot.kind)).toEqual(['slash', 'notation', 'numbered', 'tab']);

    // A caret on the clicked slash staff is drawn on its measured line; one on the numbered staff, which has no lines, in its band.
    expect(measuredStaffOfSlot(bands[0], centres, 0, docSlots)).toBe(0);
    const numbered = staveBandOfSlot(bands[0], 2, docSlots);
    expect(numbered).toEqual(bands[0].staves[2]);
    if (!numbered) return;
    expect(numberedSlotAt(bands[0], (numbered.top + numbered.bottom) / 2, docSlots)).toBe(2);
    expect(numberedSlotAt(bands[0], centres[1], docSlots)).toBeNull();
  });

  it('engraves a guitar track whose bar holds a note Pen wrote on its notation staff', () => {
    const composer = new ComposerService();
    for (let bar = 0; bar < 3; bar++) composer.appendBar();
    composer.setCursor({ ...composer.state.cursor, barIndex: 3, beatIndex: 1 });
    // D5 on the treble staff's fourth space, as a Pen click there asks for.
    composer.setNoteAtCursor({ kind: 'pitched', noteValue: 2, octave: 5 }, true);
    const errors: unknown[] = [];
    engrave(composer.state.doc, 900, errors);

    expect(errors.map(error => String((error as Error)?.stack ?? error))).toEqual([]);
  });

  it('engraves a pitched note a loaded document holds on a staff with a tuning, drawn on a string', () => {
    // Put in behind the entry commands' back, as a document from before this fix or an applied alphaTex draft could.
    const doc = ComposerService.createEmptyScore();
    const beat = doc.tracks[0].staves[0].bars[3].voices[0].beats[1];
    beat.isRest = false;
    beat.notes = [{ pitch: { kind: 'pitched', noteValue: 2, octave: 5 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
    const errors: unknown[] = [];

    engrave(doc, 900, errors);
    const note = new ScoreDocMapperService().toScore(doc, new alphaTab.Settings()).tracks[0].staves[0].bars[3].voices[0].beats[1].notes[0];

    expect(errors.map(error => String((error as Error)?.stack ?? error))).toEqual([]);
    // alphaTab's string 6 is the high E: tab string 1, fret 10.
    expect([note.string, note.fret, note.realValue]).toEqual([6, 10, 74]);
  });
});
