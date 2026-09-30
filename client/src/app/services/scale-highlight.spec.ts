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

  /** One system, one master bar, one staff bar, one beat of `notes`: head x, the note's real value, and whether it is a drum. */
  function lookupOf(notes: readonly [number, number, boolean?][]): NoteBoundsSource {
    return {
      staffSystems: [
        {
          bars: [
            {
              bars: [
                {
                  beats: [
                    {
                      notes: notes.map(([x, realValue, isPercussion = false]) => ({
                        noteHeadBounds: { x, y: 20, w: 8, h: 6 },
                        note: { realValue, isPercussion }
                      }))
                    },
                    // A beat with no note bounds: `includeNoteBounds` was off when it was laid out.
                    { notes: null }
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
});

/**
 * Against what alphaTab really lays out: `BeatBounds.notes` exists only while `core.includeNoteBounds` is on, which is what
 * the scale panel's first opening turns on (`AlphaTabService.setNoteBounds`). Rendered on this thread, as
 * `composer-score-systems.spec.ts` renders.
 */
describe('noteHighlightsOf over a real render', () => {
  function lookupOf(includeNoteBounds: boolean): alphaTab.rendering.BoundsLookup | null {
    const settings = new alphaTab.Settings();
    settings.core.engine = 'svg';
    settings.core.useWorkers = false;
    settings.core.enableLazyLoading = false;
    settings.core.includeNoteBounds = includeNoteBounds;
    // C4 E4 G4 as a chord, then D4 and B3 on their own: three notes of C major's triad, two outside it.
    const { score } = new AlphaTexService().parse(['\\track "Piano"', '\\staff {score}', '(C4 E4 G4).4 D4.4 B3.2 |'].join('\n'));
    if (!score) throw new Error('the score did not parse');
    const renderer = new alphaTab.rendering.ScoreRenderer(settings);
    renderer.width = 800;
    renderer.renderScore(score, [0]);
    return renderer.boundsLookup;
  }

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
});
