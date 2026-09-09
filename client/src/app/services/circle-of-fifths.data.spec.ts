import { TestBed } from '@angular/core/testing';

import { MusicTheoryService } from './music-theory.service';
import { CIRCLE_POSITIONS, circleOrder, keySignatureKind } from './circle-of-fifths.data';

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

  /**
   * The number beside each name, pinned against the name.
   *
   * `keySignatureKind` looks a position up by `pitchClass` rather than by
   * parsing `major`, so a number that disagreed with the name next to it would
   * move a key signature onto the wrong key and nothing else would notice.
   */
  it('gives every position the pitch class of the name beside it', () => {
    for (const position of CIRCLE_POSITIONS) {
      expect(position.pitchClass)
        .withContext(`${position.major} is not pitch class ${position.pitchClass}`)
        .toBe(index(position.major));
    }
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

  /**
   * The rule two services now share.
   *
   * It was a private method on `MusicTheoryService` reading that service's own
   * selected key, which meant the progression page could not ask it and filled
   * `ProgressionKey.preferSharps` from the scale shape's default instead - the
   * exact mistake `b514027` had already fixed once. Tested here, on the table it
   * reads, rather than only through whichever service happens to call it.
   */
  describe('keySignatureKind', () => {
    it('reads a major key straight off the circle', () => {
      expect(keySignatureKind('ionian', index('C'))).toBe('none');
      expect(keySignatureKind('ionian', index('G'))).toBe('sharp');
      expect(keySignatureKind('ionian', index('F'))).toBe('flat');
      expect(keySignatureKind('ionian', index('Eb'))).toBe('flat');
      expect(keySignatureKind('ionian', index('B'))).toBe('sharp');
    });

    // The whole point of the mode offsets: a minor key has a signature of its
    // own and it is its relative major's, not its scale shape's default.
    it('works a mode back to its parent major', () => {
      expect(keySignatureKind('aeolian', index('E'))).toBe('sharp');
      expect(keySignatureKind('aeolian', index('D'))).toBe('flat');
      expect(keySignatureKind('aeolian', index('A'))).toBe('none');
      expect(keySignatureKind('dorian', index('E'))).toBe('sharp');
      expect(keySignatureKind('mixolydian', index('A'))).toBe('sharp');
    });

    /**
     * A harmonic minor's key signature is its *natural* minor's, with the
     * raised seventh written on the note - so E harmonic minor is the one sharp
     * E aeolian carries, not the C major nothing here used to give it. The same
     * convention covers melodic minor and Hungarian minor, and each of the two
     * scales that appears in the app twice is listed under both of its ids.
     */
    it('gives every mainstream minor its natural minor signature', () => {
      for (const scaleId of [
        'harmonicMinor',
        'harmonicMinorMode1',
        'melodicMinor',
        'melodicMinorMode1',
        'hungarianMinor'
      ]) {
        expect(keySignatureKind(scaleId, index('E'))).withContext(scaleId).toBe('sharp');
        expect(keySignatureKind(scaleId, index('D'))).withContext(scaleId).toBe('flat');
        expect(keySignatureKind(scaleId, index('A'))).withContext(scaleId).toBe('none');
      }
    });

    /**
     * Each mode of harmonic minor is an ordinary diatonic mode with one note
     * raised - a chromatic raise moves no letter name - so it takes that mode's
     * signature. The app's own names say which mode: "Locrian ♮6", "Ionian
     * Augmented", "Dorian ♯4", "Lydian ♯2", and phrygian dominant, which is
     * phrygian with a raised third.
     */
    it('reads a mode of harmonic minor as the mode it is named after', () => {
      // On C rather than E, where phrygian's own answer is 'none' and the
      // comparison would pass against anything that also had no opinion.
      expect(keySignatureKind('phrygian', index('C'))).toBe('flat');
      expect(keySignatureKind('phrygianDominant', index('C'))).toBe('flat');
      expect(keySignatureKind('phrygianDominantMode', index('C'))).toBe('flat');
      expect(keySignatureKind('dorianSharp4', index('E'))).toBe(
        keySignatureKind('dorian', index('E'))
      );
      expect(keySignatureKind('locrianNat6', index('E'))).toBe(
        keySignatureKind('locrian', index('E'))
      );
      expect(keySignatureKind('ionianAugmented', index('E'))).toBe(
        keySignatureKind('ionian', index('E'))
      );
      expect(keySignatureKind('lydianSharp2', index('E'))).toBe(
        keySignatureKind('lydian', index('E'))
      );
    });

    it('has no opinion about a scale with no parent major', () => {
      expect(keySignatureKind('majorPentatonic', 0)).toBeNull();
      expect(keySignatureKind('minorBlues', 0)).toBeNull();
      expect(keySignatureKind('', 0)).toBeNull();
    });

    /**
     * Seven notes is not enough to be a key. The modes of melodic minor carry
     * two raised degrees and so read as more than one diatonic mode plus
     * accidentals; ultra locrian is built *on* harmonic minor's raised note, so
     * it stands a semitone off the mode it would otherwise be; and the exotic
     * heptatonics have no settled engraving at all. Each keeps whatever
     * spelling it declares for itself rather than being handed an invented
     * parent.
     */
    it('has no opinion about a heptatonic scale with no settled signature', () => {
      for (const scaleId of [
        'lydianDominant',
        'superLocrian',
        'locrianNat2',
        'ultraLocrian',
        'doubleHarmonic',
        'neapolitanMajor',
        'persian'
      ]) {
        expect(keySignatureKind(scaleId, index('E'))).withContext(scaleId).toBeNull();
      }
    });

    /**
     * A caller that could not resolve a note name hands this -1, and `NaN`
     * reaches it the same way. Both survive the modulo as a plausible-looking
     * parent, so they are refused rather than answered.
     */
    it('has no opinion about a tonic that is not a pitch class', () => {
      expect(keySignatureKind('ionian', -1)).toBeNull();
      expect(keySignatureKind('ionian', 12)).toBeNull();
      expect(keySignatureKind('ionian', NaN)).toBeNull();
      expect(keySignatureKind('ionian', 1.5)).toBeNull();
    });
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
