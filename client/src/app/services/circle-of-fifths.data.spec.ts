import { TestBed } from '@angular/core/testing';

import { MusicTheoryService } from './music-theory.service';
import { CIRCLE_POSITIONS, circleOrder } from './circle-of-fifths.data';

/**
 * The reference data, checked against interval arithmetic rather than against a
 * copy of itself.
 *
 * A test that lists twelve keys and asserts the constant lists the same twelve
 * proves only that someone typed the same thing twice. What is worth pinning is
 * that the sequence *is* a circle of fifths: every step seven semitones, every
 * relative minor nine above its major, every signature one accidental further
 * from C than the last.
 *
 * The semitone numbers come from `MusicTheoryService.getNoteIndex`, which is
 * deliberate. It makes these assertions double as the integration check: a name
 * the service cannot resolve returns -1 and fails here, so the circle cannot
 * emit a key the rest of the app does not understand.
 */
describe('circle of fifths data', () => {
  let service: MusicTheoryService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MusicTheoryService);
  });

  /** Semitone index, and a failure if the service cannot spell the name. */
  function index(name: string): number {
    const at = service.getNoteIndex(name);
    expect(at)
      .withContext(`the service cannot resolve '${name}'`)
      .toBeGreaterThanOrEqual(0);
    return at;
  }

  it('has twelve positions', () => {
    expect(CIRCLE_POSITIONS.length).toBe(12);
  });

  it('starts at C', () => {
    expect(CIRCLE_POSITIONS[0].major).toBe('C');
  });

  it('steps a perfect fifth at every position', () => {
    for (let at = 0; at < CIRCLE_POSITIONS.length; at++) {
      const from = index(CIRCLE_POSITIONS[at].major);
      const to = index(CIRCLE_POSITIONS[(at + 1) % CIRCLE_POSITIONS.length].major);

      expect((to - from + 12) % 12)
        .withContext(
          `${CIRCLE_POSITIONS[at].major} to ` +
            `${CIRCLE_POSITIONS[(at + 1) % 12].major} is not a fifth`
        )
        .toBe(7);
    }
  });

  it('names every key once, with no pitch repeated', () => {
    const pitches = CIRCLE_POSITIONS.map(p => index(p.major));
    expect(new Set(pitches).size).toBe(12);
  });

  it('puts each relative minor nine semitones above its major', () => {
    for (const position of CIRCLE_POSITIONS) {
      expect((index(position.minor) - index(position.major) + 12) % 12)
        .withContext(`${position.minor} minor is not the relative of ${position.major}`)
        .toBe(9);
    }
  });

  it('counts accidentals up to six sharps and back down through the flats', () => {
    const signatures = CIRCLE_POSITIONS.map(p =>
      p.accidentalKind === 'flat' ? -p.accidentals : p.accidentals
    );

    // C, then one more sharp each step round to six, then five flats
    // decreasing back to one. That is the whole shape of the circle.
    expect(signatures).toEqual([0, 1, 2, 3, 4, 5, 6, -5, -4, -3, -2, -1]);
  });

  it('marks the only enharmonic position and spells it both ways', () => {
    const enharmonic = CIRCLE_POSITIONS.filter(p => p.majorEnharmonic !== null);

    expect(enharmonic.length).toBe(1);
    expect(enharmonic[0].major).toBe('F#');
    expect(enharmonic[0].majorEnharmonic).toBe('Gb');

    // Same pitch, different spelling - which is the entire reason it is split.
    expect(index('F#')).toBe(index('Gb'));
    expect(index(enharmonic[0].minor)).toBe(index(enharmonic[0].minorEnharmonic!));

    // And the two spellings carry opposite signatures. Six sharps for F sharp
    // major, six flats for G flat major - a wedge whose halves both claimed
    // sharps would be telling a reader the wrong thing about half of itself.
    expect(enharmonic[0].accidentalKind).toBe('sharp');
    expect(enharmonic[0].enharmonicAccidentalKind).toBe('flat');
  });

  it('gives no enharmonic signature to the positions that have no enharmonic', () => {
    for (const position of CIRCLE_POSITIONS) {
      if (position.majorEnharmonic === null) {
        expect(position.enharmonicAccidentalKind)
          .withContext(`${position.major} has no enharmonic but claims a second signature`)
          .toBeNull();
      }
    }
  });

  /**
   * The whole of the fourths implementation. If this ever passes against a
   * second hard-coded array rather than a reversal, the toggle has been
   * "fixed" into two things that can drift apart.
   */
  it('reads as ascending fourths in the other direction', () => {
    const fourths = circleOrder('fourths');

    expect(fourths.length).toBe(12);
    expect(fourths[0].major).toBe('C');

    for (let at = 0; at < fourths.length; at++) {
      const from = index(fourths[at].major);
      const to = index(fourths[(at + 1) % fourths.length].major);

      expect((to - from + 12) % 12)
        .withContext(`${fourths[at].major} to ${fourths[(at + 1) % 12].major} is not a fourth`)
        .toBe(5);
    }
  });

  it('keeps the tonic at the top in both directions', () => {
    expect(circleOrder('fifths')[0].major).toBe('C');
    expect(circleOrder('fourths')[0].major).toBe('C');
  });

  it('is the same twelve positions in either direction', () => {
    const fifths = circleOrder('fifths').map(p => p.major).sort();
    const fourths = circleOrder('fourths').map(p => p.major).sort();

    expect(fourths).toEqual(fifths);
  });

  it('spells the sharp side with sharps and the flat side with flats', () => {
    // Not cosmetic: `MusicTheoryService.flatKeys` reads the key name to decide
    // how the whole app spells notes, so this is what makes clicking Gb show a
    // fretboard in flats.
    for (const position of CIRCLE_POSITIONS) {
      if (position.accidentalKind === 'flat') {
        expect(position.major.includes('b') || position.major === 'F')
          .withContext(`${position.major} is on the flat side but is not spelled flat`)
          .toBeTrue();
      }

      if (position.accidentalKind === 'sharp' && position.accidentals > 0) {
        expect(position.major.includes('b'))
          .withContext(`${position.major} is on the sharp side but is spelled flat`)
          .toBeFalse();
      }
    }
  });
});
