import { ComposerService } from './composer.service';
import { MIXED, popoverValuesOf } from './composer-popover-values';
import { deepFrozen } from './deep-frozen';
import { writtenBeats } from './written-beats.spec-helper';
import { EditCursor, ScoreDoc, createDefaultCursor } from '../models/composer.model';

describe('popoverValuesOf', () => {
  const at = (barIndex: number, beatIndex = 0): EditCursor => ({ ...createDefaultCursor(), barIndex, beatIndex });
  const frozen = (doc: ScoreDoc): ScoreDoc => deepFrozen(structuredClone(doc));

  /** The empty score with bar 2 in G major, a bass clef, a section, ending 1 and a triplet feel. */
  function withBarTwoApart(): ScoreDoc {
    const doc = ComposerService.createEmptyScore();
    const bar = doc.tracks[0].staves[0].bars[2];
    bar.keySignature = { fifths: 1, mode: 'major' };
    bar.clef = 'f4';
    Object.assign(doc.masterBars[2], { section: { marker: 'B', text: 'Chorus' }, alternateEndings: 1, tripletFeel: 'triplet8th' });
    return doc;
  }

  it('reads the first selected bar, whichever end of the range moved', () => {
    // Bars 2 and 3 share every value but the meter, which Time signature reads at the first bar alone.
    const doc = withBarTwoApart();
    doc.tracks[0].staves[0].bars[3] = structuredClone(doc.tracks[0].staves[0].bars[2]);
    doc.masterBars[3] = { ...structuredClone(doc.masterBars[2]), timeSignature: { numerator: 3, denominator: 4, isCommon: false } };

    for (const [anchor, head] of [[at(2), at(3)], [at(3), at(2)]]) {
      const values = popoverValuesOf(frozen(doc), anchor, head);
      expect(values.timeSignature.numerator).toBe(4);
      expect(values.keySignature).toEqual({ fifths: 1, mode: 'major' });
      expect(values.section).toEqual({ marker: 'B', text: 'Chorus' });
      expect(values.clef).toBe('f4');
    }
  });

  it('says mixed for each value the selected bars do not share, and nothing else', () => {
    const values = popoverValuesOf(frozen(withBarTwoApart()), at(1), at(2));

    expect(values.keySignature).toBe(MIXED);
    expect(values.clef).toBe(MIXED);
    expect(values.ottava).toBe('regular');
    expect(values.section).toBe(MIXED);
    expect(values.alternateEndings).toBe(MIXED);
    expect(values.tripletFeel).toBe(MIXED);
  });

  it('reads the key over every staff, which Key signature writes', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    doc.tracks[1].staves[0].bars[1].keySignature = { fifths: 1, mode: 'major' };

    expect(popoverValuesOf(frozen(doc), at(0), at(1)).keySignature).toBe(MIXED);
    expect(popoverValuesOf(frozen(doc), null, at(1)).keySignature).toBe(MIXED);
    expect(popoverValuesOf(frozen(doc), null, at(0)).keySignature).toEqual({ fifths: 0, mode: 'major' });
  });

  it('reads the tuplet the selection\'s beats share, graces aside, or mixed', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[0].voices[0].beats = writtenBeats('n4t3 g n4t3 n4t3 n2');

    expect(popoverValuesOf(frozen(doc), at(0, 0), at(0, 3)).tuplet).toEqual({ numerator: 3, denominator: 2 });
    expect(popoverValuesOf(frozen(doc), at(0, 0), at(0, 4)).tuplet).toBe(MIXED);
    expect(popoverValuesOf(frozen(doc), null, at(0, 4)).tuplet).toBeNull();
  });
});
