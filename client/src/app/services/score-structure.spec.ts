import { ComposerService } from './composer.service';
import { insertBarInto } from './score-structure';
import { effectiveTimeSignature } from '../models/composer.model';

describe('insertBarInto', () => {
  it('appends a bar to every staff of every track, in the meter in force', () => {
    const doc = ComposerService.createEmptyScore();
    doc.masterBars[0].timeSignature = { numerator: 3, denominator: 4, isCommon: false };
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));

    const at = insertBarInto(doc, doc.masterBars.length);

    expect(at).toBe(4);
    expect(doc.masterBars.length).toBe(5);
    for (const track of doc.tracks) {
      expect(track.staves[0].bars.length).toBe(5);
      expect(track.staves[0].bars[4].voices[0].beats.length).toBe(3);
    }
    expect(effectiveTimeSignature(doc.masterBars, 4).numerator).toBe(3);
  });

  it('clamps an index past the end to an append', () => {
    const doc = ComposerService.createEmptyScore();

    expect(insertBarInto(doc, 99)).toBe(4);
  });
});
