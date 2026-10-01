import * as alphaTab from '@coderline/alphatab';

import { HighlightConfig } from '../models/alpha-tab.model';
import { AlphaTexService } from './alpha-tex.service';
import { NoteBoundsSource, noteHighlightsOf, pitchClassesOf } from './scale-highlight';

describe('pitchClassesOf', () => {
  const aMinorPentatonic: HighlightConfig = { enabled: true, rootNote: 9, intervals: [0, 3, 5, 7, 10], name: 'A Minor Pentatonic', type: 'scale' };

  it('marks the root and the rest of the scale, wrapping past B', () => {
    expect([...pitchClassesOf(aMinorPentatonic)].sort((a, b) => a[0] - b[0])).toEqual([
      [0, 'inScale'],
      [2, 'inScale'],
      [4, 'inScale'],
      [7, 'inScale'],
      [9, 'root']
    ]);
  });

  it('marks nothing while the highlight is off', () => {
    expect(pitchClassesOf({ ...aMinorPentatonic, enabled: false }).size).toBe(0);
  });
});

describe('noteHighlightsOf', () => {
  const cMajorTriad: HighlightConfig = { enabled: true, rootNote: 0, intervals: [0, 4, 7], name: 'C Major', type: 'chord' };

  /** A staff drawn as standard notation alone. */
  const notationOnly = { showSlash: false, showStandardNotation: true, showNumbered: false };

  /** A beat of `notes`, on `staff`: head x, the note's real value, whether it is a drum, and whether it is dead. */
  function beatOf(staff: typeof notationOnly, notes: readonly [number, number, boolean?, boolean?][]) {
    return {
      beat: { voice: { bar: { staff } } },
      notes: notes.map(([x, realValue, isPercussion = false, isDead = false]) => ({
        noteHeadBounds: { x, y: 20, w: 8, h: 6 },
        note: { realValue, isPercussion, isDead }
      }))
    };
  }

  /** One system, one master bar, one staff bar, one beat of `notes` on a notation staff (`beatOf`). */
  function lookupOf(notes: readonly [number, number, boolean?, boolean?][]): NoteBoundsSource {
    return {
      staffSystems: [
        {
          bars: [
            {
              bars: [
                {
                  beats: [
                    beatOf(notationOnly, notes),
                    // A beat with no note bounds: `includeNoteBounds` was off when it was laid out.
                    { beat: { voice: { bar: { staff: notationOnly } } }, notes: null }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };
  }

  it('marks each note head whose pitch class is in the chord, root apart, in any octave', () => {
    const lookup = lookupOf([
      [10, 60],
      [20, 64],
      [30, 66],
      [40, 43]
    ]);

    expect(noteHighlightsOf(lookup, cMajorTriad)).toEqual([
      { x: 10, y: 20, w: 8, h: 6, kind: 'root' },
      { x: 20, y: 20, w: 8, h: 6, kind: 'inScale' },
      { x: 40, y: 20, w: 8, h: 6, kind: 'inScale' }
    ]);
  });

  it('never marks a drum hit, whose value is an articulation rather than a pitch', () => {
    expect(noteHighlightsOf(lookupOf([[10, 36, true]]), cMajorTriad)).toEqual([]);
  });

  it('marks nothing while the highlight is off', () => {
    expect(noteHighlightsOf(lookupOf([[10, 60]]), { ...cMajorTriad, enabled: false })).toEqual([]);
  });

  it('never marks a dead note, which sounds no pitch', () => {
    expect(noteHighlightsOf(lookupOf([[10, 60, false, true]]), cMajorTriad)).toEqual([]);
  });

  it('skips a note the lookup could not find, as when a worker\'s bounds arrive for a score since replaced', () => {
    const lookup = lookupOf([[10, 60]]);
    const beat = lookup.staffSystems[0].bars[0].bars[0].beats[0];
    const stale: NoteBoundsSource = {
      staffSystems: [{ bars: [{ bars: [{ beats: [{ ...beat, notes: [{ noteHeadBounds: { x: 30, y: 20, w: 8, h: 6 }, note: undefined }] }] }] }] }]
    };

    expect(noteHighlightsOf(stale, cMajorTriad)).toEqual([]);
  });

  it("marks a staff's notation and tablature, and not its slash or numbered bands, whose one head per beat names no pitch", () => {
    // alphaTab's bands for one staff in one master bar, in its order: slash, notation, numbered, tablature.
    const staff = { showSlash: true, showStandardNotation: true, showNumbered: true };
    const lookup: NoteBoundsSource = {
      staffSystems: [
        {
          bars: [
            {
              bars: [
                { beats: [beatOf(staff, [[1, 60]])] },
                { beats: [beatOf(staff, [[2, 60]])] },
                { beats: [beatOf(staff, [[3, 60]])] },
                { beats: [beatOf(staff, [[4, 60]])] },
                // The next staff starts its own count: its first band is its notation.
                { beats: [beatOf({ ...notationOnly }, [[5, 60]])] }
              ]
            }
          ]
        }
      ]
    };

    expect(noteHighlightsOf(lookup, cMajorTriad).map(mark => mark.x)).toEqual([2, 4, 5]);
  });
});

/**
 * Against what alphaTab really lays out: `BeatBounds.notes` exists only while `core.includeNoteBounds` is on, which is what
 * the scale panel's first opening turns on (`AlphaTabService.setNoteBounds`). Rendered on this thread, as
 * `composer-score-systems.spec.ts` renders.
 */
describe('noteHighlightsOf over a real render', () => {
  // C4 E4 G4 as a chord, then D4 and B3 on their own: three notes of C major's triad, two outside it.
  const piano = ['\\track "Piano"', '\\staff {score}', '(C4 E4 G4).4 D4.4 B3.2 |'];

  function lookupOf(includeNoteBounds: boolean, tex: readonly string[] = piano): alphaTab.rendering.BoundsLookup | null {
    const settings = new alphaTab.Settings();
    settings.core.engine = 'svg';
    settings.core.useWorkers = false;
    settings.core.enableLazyLoading = false;
    settings.core.includeNoteBounds = includeNoteBounds;
    const { score } = new AlphaTexService().parse(tex.join('\n'));
    if (!score) throw new Error('the score did not parse');
    const renderer = new alphaTab.rendering.ScoreRenderer(settings);
    renderer.width = 800;
    renderer.renderScore(score, [0]);
    return renderer.boundsLookup;
  }

  /** The lookup of `tex`, with note bounds on, or a failure. */
  function drawn(tex: readonly string[]): alphaTab.rendering.BoundsLookup {
    const lookup = lookupOf(true, tex);
    if (!lookup) throw new Error('nothing was laid out');
    return lookup;
  }

  /** The drawn bands of master bar 0, top to bottom: each band's lines, top and bottom, in the lookup's pixels. */
  const bandsOf = (lookup: alphaTab.rendering.BoundsLookup) =>
    lookup.staffSystems[0].bars[0].bars.map(bar => ({ top: bar.visualBounds.y, bottom: bar.visualBounds.y + bar.visualBounds.h }));

  /** Which band of master bar 0 a mark is on: the nearest to its centre, since a head on a ledger line is off the lines. */
  const bandOf = (lookup: alphaTab.rendering.BoundsLookup, mark: { y: number; h: number }): number => {
    const centre = mark.y + mark.h / 2;
    const distances = bandsOf(lookup).map(band => Math.max(band.top - centre, centre - band.bottom, 0));
    return distances.indexOf(Math.min(...distances));
  };

  const cMajorTriad: HighlightConfig = { enabled: true, rootNote: 0, intervals: [0, 4, 7], name: 'C Major', type: 'chord' };

  it('marks the chord tones alphaTab drew, each on its own note head', () => {
    const lookup = lookupOf(true);
    if (!lookup) throw new Error('nothing was laid out');

    const marks = noteHighlightsOf(lookup, cMajorTriad);

    expect(marks.map(mark => mark.kind).sort()).toEqual(['inScale', 'inScale', 'root']);
    expect(new Set(marks.map(mark => mark.y)).size).toBe(3);
    expect(marks.every(mark => mark.w > 0 && mark.h > 0)).toBeTrue();
  });

  it('has nothing to mark while note bounds are off, which is why the panel turns them on', () => {
    const lookup = lookupOf(false);
    if (!lookup) throw new Error('nothing was laid out');

    expect(noteHighlightsOf(lookup, cMajorTriad)).toEqual([]);
  });

  const guitar = ['\\track "Guitar"', '\\staff {score tabs}', '\\tuning E4 B3 G3 D3 A2 E2'];

  it("marks a capoed guitar's notes by the pitch they sound, on the notation's head and the tablature's fret number alike", () => {
    // Capo 2: fret 3 on the G string sounds C4, root; fret 1 on the high E string sounds G4, in the triad; the open B
    // string sounds C#4, outside it. Without the capo they would be Bb, F and B, none of C major's.
    const lookup = drawn([...guitar, '\\capo 2', '3.3.4 1.1.4 0.2.2 |']);

    const marks = noteHighlightsOf(lookup, cMajorTriad);

    expect(bandsOf(lookup).length).withContext('a notation band and a tablature band').toBe(2);
    expect(marks.map(mark => [mark.kind, bandOf(lookup, mark)]).sort()).toEqual([
      ['inScale', 0],
      ['inScale', 1],
      ['root', 0],
      ['root', 1]
    ]);
  });

  it('never marks a dead note, on the notation or the tablature', () => {
    // A dead note on the A string, and an open A: A minor's root, which only the open string sounds.
    const lookup = drawn([...guitar, ':2 x.5 0.5 |']);
    const aMinor: HighlightConfig = { enabled: true, rootNote: 9, intervals: [0, 3, 7], name: 'A Minor', type: 'chord' };

    const marks = noteHighlightsOf(lookup, aMinor);

    expect(marks.map(mark => [mark.kind, bandOf(lookup, mark)]).sort()).withContext('the open A alone, once on each band').toEqual([
      ['root', 0],
      ['root', 1]
    ]);
  });

  it('marks no slash or numbered head, which stands for the whole beat rather than a pitch, and marks the notation beside them', () => {
    const lookup = drawn(['\\track "Piano"', '\\staff {slash score numbered}', 'C4.4 C4.4 C4.2 |']);

    const marks = noteHighlightsOf(lookup, cMajorTriad);

    expect(bandsOf(lookup).length).withContext('slash, notation and numbered bands').toBe(3);
    expect(marks.length).toBe(3);
    expect(marks.every(mark => bandOf(lookup, mark) === 1)).withContext('all on the notation band').toBeTrue();
  });

  it('never marks a drum track, whatever the highlight names', () => {
    const lookup = drawn(['\\track "Drums" {instrument percussion}', '\\articulation defaults', '("Kick (hit)" "Hi-Hat (closed)").4 "Snare (hit)".4 r.2 |']);
    const everyPitch: HighlightConfig = { enabled: true, rootNote: 0, intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], name: 'C Chromatic', type: 'scale' };

    expect(lookup.staffSystems[0].bars[0].bars[0].beats[0].notes?.length).withContext('the kit has note bounds to skip').toBe(2);
    expect(noteHighlightsOf(lookup, everyPitch)).toEqual([]);
  });
});
