import { createExtensions } from '../models/progression-normalize';
import { deepFrozen } from './deep-frozen.spec-helper';
import { ChordExtent, ChordQuality, ChordShape } from './progression-harmony';
import {
  MotionReason,
  NextChordTarget,
  TriadFamily,
  likelyNextDegrees,
  triadFamilyAt,
  triadFamilyOf
} from './progression-next-chords';

/**
 * The next-chord tables, checked row by row against the design doc's section 2,
 * which is where each entry was checked against harmony references. A wrong row
 * here teaches something false, so every row is written out rather than swept.
 */
describe('likelyNextDegrees', () => {
  const IONIAN = [0, 2, 4, 5, 7, 9, 11];
  const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
  const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];
  const MELODIC_MINOR = [0, 2, 3, 5, 7, 9, 11];
  const DORIAN = [0, 2, 3, 5, 7, 9, 10];
  const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
  const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
  const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];
  const HUNGARIAN_MINOR = [0, 2, 3, 6, 7, 8, 11];
  const MAJOR_PENTATONIC = [0, 2, 4, 7, 9];

  function shape(
    degree: number,
    alter = 0,
    quality: ChordQuality | null = null,
    extent: ChordExtent = 3
  ): ChordShape {
    return { degree, alter, quality, extent, suspension: 'none', extensions: createExtensions() };
  }

  function t(degree: number, alter: number, family: TriadFamily, reason: MotionReason): NextChordTarget {
    return { degree, alter, family, reason };
  }

  function targetsOf(intervals: readonly number[], selected: ChordShape): readonly NextChordTarget[] {
    const next = likelyNextDegrees(intervals, selected);
    if (next.kind !== 'targets') throw new Error(`expected targets, got ${next.kind}`);
    return next.targets;
  }

  describe('major (ionian)', () => {
    it('lets the tonic go anywhere', () => {
      expect(likelyNextDegrees(IONIAN, shape(0)).kind).toBe('any');
    });

    it('ii -> V, vii°', () => {
      expect(targetsOf(IONIAN, shape(1))).toEqual([
        t(4, 0, 'major', 'predominant-to-dominant'),
        t(6, 0, 'diminished', 'predominant-to-dominant')
      ]);
    });

    it('iii -> vi, IV', () => {
      expect(targetsOf(IONIAN, shape(2))).toEqual([
        t(5, 0, 'minor', 'falling-fifth'),
        t(3, 0, 'major', 'rising-step')
      ]);
    });

    it('IV -> V, vii°, ii, I', () => {
      expect(targetsOf(IONIAN, shape(3))).toEqual([
        t(4, 0, 'major', 'predominant-to-dominant'),
        t(6, 0, 'diminished', 'predominant-to-dominant'),
        t(1, 0, 'minor', 'falling-third'),
        t(0, 0, 'major', 'plagal')
      ]);
    });

    it('V -> I, vi', () => {
      expect(targetsOf(IONIAN, shape(4))).toEqual([
        t(0, 0, 'major', 'dominant-to-tonic'),
        t(5, 0, 'minor', 'deceptive')
      ]);
    });

    it('vi -> ii, IV, V', () => {
      expect(targetsOf(IONIAN, shape(5))).toEqual([
        t(1, 0, 'minor', 'falling-fifth'),
        t(3, 0, 'major', 'falling-third'),
        t(4, 0, 'major', 'falling-step')
      ]);
    });

    it('vii° -> I', () => {
      expect(targetsOf(IONIAN, shape(6))).toEqual([t(0, 0, 'major', 'dominant-to-tonic')]);
    });
  });

  describe('borrowed chords in a major key', () => {
    it('♭II -> V', () => {
      expect(targetsOf(IONIAN, shape(1, -1, 'major'))).toEqual([
        t(4, 0, 'major', 'predominant-to-dominant')
      ]);
    });

    it('♭III -> ♭VI, IV', () => {
      expect(targetsOf(IONIAN, shape(2, -1, 'major'))).toEqual([
        t(5, -1, 'major', 'falling-fifth'),
        t(3, 0, 'major', 'rising-step')
      ]);
    });

    it('iv -> V, I', () => {
      expect(targetsOf(IONIAN, shape(3, 0, 'minor'))).toEqual([
        t(4, 0, 'major', 'predominant-to-dominant'),
        t(0, 0, 'major', 'plagal')
      ]);
    });

    it('♭VI -> ♭VII, V, iv', () => {
      expect(targetsOf(IONIAN, shape(5, -1, 'major'))).toEqual([
        t(6, -1, 'major', 'rising-step'),
        t(4, 0, 'major', 'predominant-to-dominant'),
        t(3, 0, 'minor', 'falling-third')
      ]);
    });

    it('♭VII -> I, IV', () => {
      expect(targetsOf(IONIAN, shape(6, -1, 'major'))).toEqual([
        t(0, 0, 'major', 'modal-cadence'),
        t(3, 0, 'major', 'double-plagal')
      ]);
    });

    it('applies in ionian only: dorian\'s ♭VI has no row', () => {
      expect(likelyNextDegrees(DORIAN, shape(5, -1, 'major')).kind).toBe('none');
    });
  });

  describe('minor (aeolian)', () => {
    it('lets the tonic go anywhere', () => {
      expect(likelyNextDegrees(AEOLIAN, shape(0)).kind).toBe('any');
    });

    it('ii° -> V, vii° - the major V and the raised vii°', () => {
      expect(targetsOf(AEOLIAN, shape(1))).toEqual([
        t(4, 0, 'major', 'predominant-to-dominant'),
        t(6, 1, 'diminished', 'predominant-to-dominant')
      ]);
    });

    it('♭II (Neapolitan) -> V', () => {
      expect(targetsOf(AEOLIAN, shape(1, -1, 'major'))).toEqual([
        t(4, 0, 'major', 'predominant-to-dominant')
      ]);
    });

    it('III -> VI, iv', () => {
      expect(targetsOf(AEOLIAN, shape(2))).toEqual([
        t(5, 0, 'major', 'falling-fifth'),
        t(3, 0, 'minor', 'rising-step')
      ]);
    });

    it('iv -> V, vii°, ii°, i', () => {
      expect(targetsOf(AEOLIAN, shape(3))).toEqual([
        t(4, 0, 'major', 'predominant-to-dominant'),
        t(6, 1, 'diminished', 'predominant-to-dominant'),
        t(1, 0, 'diminished', 'falling-third'),
        t(0, 0, 'minor', 'plagal')
      ]);
    });

    it('V (the borrowed major dominant) -> i, VI', () => {
      expect(targetsOf(AEOLIAN, shape(4, 0, 'major'))).toEqual([
        t(0, 0, 'minor', 'dominant-to-tonic'),
        t(5, 0, 'major', 'deceptive')
      ]);
    });

    it('v (the key\'s own minor dominant) -> VI, iv', () => {
      expect(targetsOf(AEOLIAN, shape(4))).toEqual([
        t(5, 0, 'major', 'rising-step'),
        t(3, 0, 'minor', 'falling-step')
      ]);
    });

    it('VI -> ii°, iv, V', () => {
      expect(targetsOf(AEOLIAN, shape(5))).toEqual([
        t(1, 0, 'diminished', 'falling-fifth'),
        t(3, 0, 'minor', 'falling-third'),
        t(4, 0, 'major', 'predominant-to-dominant')
      ]);
    });

    it('VII -> III, i', () => {
      expect(targetsOf(AEOLIAN, shape(6))).toEqual([
        t(2, 0, 'major', 'falling-fifth'),
        t(0, 0, 'minor', 'aeolian-cadence')
      ]);
    });

    it('vii° (raised) -> i', () => {
      expect(targetsOf(AEOLIAN, shape(6, 1, 'diminished'))).toEqual([
        t(0, 0, 'minor', 'dominant-to-tonic')
      ]);
    });
  });

  describe('the minor table in the other two minor forms', () => {
    it('harmonic minor: vii° is the key\'s own, so its alter is 0', () => {
      expect(targetsOf(HARMONIC_MINOR, shape(1))).toEqual([
        t(4, 0, 'major', 'predominant-to-dominant'),
        t(6, 0, 'diminished', 'predominant-to-dominant')
      ]);
    });

    it('harmonic minor: VII is a lowered seventh, alter -1', () => {
      // VII is a target nowhere in the table except as a source, so check it
      // as a source: the lowered VII still finds its row.
      expect(targetsOf(HARMONIC_MINOR, shape(6, -1, 'major'))).toEqual([
        t(2, 0, 'major', 'falling-fifth'),
        t(0, 0, 'minor', 'aeolian-cadence')
      ]);
    });

    it('harmonic minor: the key\'s own III+ uses the III row', () => {
      expect(targetsOf(HARMONIC_MINOR, shape(2))).toEqual([
        t(5, 0, 'major', 'falling-fifth'),
        t(3, 0, 'minor', 'rising-step')
      ]);
    });

    it('melodic minor: the key\'s own IV uses the iv row, and VI is lowered', () => {
      expect(targetsOf(MELODIC_MINOR, shape(3))).toEqual([
        t(4, 0, 'major', 'predominant-to-dominant'),
        t(6, 0, 'diminished', 'predominant-to-dominant'),
        t(1, 0, 'diminished', 'falling-third'),
        t(0, 0, 'minor', 'plagal')
      ]);
      expect(targetsOf(MELODIC_MINOR, shape(2))).toEqual([
        t(5, -1, 'major', 'falling-fifth'),
        t(3, 0, 'minor', 'rising-step')
      ]);
    });

    it('melodic minor: vi° has no row', () => {
      expect(likelyNextDegrees(MELODIC_MINOR, shape(5)).kind).toBe('none');
    });
  });

  describe('church modes', () => {
    it('dorian: i -> IV, IV -> i', () => {
      expect(targetsOf(DORIAN, shape(0))).toEqual([t(3, 0, 'major', 'modal-signature')]);
      expect(targetsOf(DORIAN, shape(3))).toEqual([t(0, 0, 'minor', 'modal-cadence')]);
    });

    it('phrygian: i -> ♭II, ♭II -> i', () => {
      expect(targetsOf(PHRYGIAN, shape(0))).toEqual([t(1, 0, 'major', 'modal-signature')]);
      expect(targetsOf(PHRYGIAN, shape(1))).toEqual([t(0, 0, 'minor', 'modal-cadence')]);
    });

    it('lydian: I -> II, II -> I', () => {
      expect(targetsOf(LYDIAN, shape(0))).toEqual([t(1, 0, 'major', 'modal-signature')]);
      expect(targetsOf(LYDIAN, shape(1))).toEqual([t(0, 0, 'major', 'modal-cadence')]);
    });

    it('mixolydian: I -> ♭VII, ♭VII -> I, v -> I', () => {
      expect(targetsOf(MIXOLYDIAN, shape(0))).toEqual([t(6, 0, 'major', 'modal-signature')]);
      expect(targetsOf(MIXOLYDIAN, shape(6))).toEqual([t(0, 0, 'major', 'modal-cadence')]);
      expect(targetsOf(MIXOLYDIAN, shape(4))).toEqual([t(0, 0, 'major', 'modal-cadence')]);
    });

    it('gives every other chord in a mode no hint', () => {
      expect(likelyNextDegrees(DORIAN, shape(1)).kind).toBe('none');
    });
  });

  describe('secondary dominants', () => {
    it('D major in C is V/V and hints V', () => {
      expect(targetsOf(IONIAN, shape(1, 0, 'major'))).toEqual([
        t(4, 0, 'major', 'secondary-dominant')
      ]);
    });

    it('E7 in C is V/vi and hints vi', () => {
      expect(targetsOf(IONIAN, shape(2, 0, 'dominant7', 7))).toEqual([
        t(5, 0, 'minor', 'secondary-dominant')
      ]);
    });

    it('a major I in aeolian is V/iv', () => {
      expect(targetsOf(AEOLIAN, shape(0, 0, 'major'))).toEqual([
        t(3, 0, 'minor', 'secondary-dominant')
      ]);
    });

    it('a major V in mixolydian resolves to the tonic, named as such', () => {
      expect(targetsOf(MIXOLYDIAN, shape(4, 0, 'major'))).toEqual([
        t(0, 0, 'major', 'dominant-to-tonic')
      ]);
    });

    it('a minor chromatic chord is no dominant', () => {
      expect(likelyNextDegrees(IONIAN, shape(4, 0, 'minor')).kind).toBe('none');
    });
  });

  describe('reading the selected chord', () => {
    it('V7, ii7 and viiø7 find their triad rows', () => {
      expect(targetsOf(IONIAN, shape(4, 0, null, 7))[0]).toEqual(t(0, 0, 'major', 'dominant-to-tonic'));
      expect(targetsOf(IONIAN, shape(1, 0, null, 7))[0]).toEqual(t(4, 0, 'major', 'predominant-to-dominant'));
      expect(targetsOf(IONIAN, shape(6, 0, null, 7))).toEqual([t(0, 0, 'major', 'dominant-to-tonic')]);
    });

    it('reads a suspended chord by the triad under it', () => {
      const vSus4: ChordShape = { ...shape(4), suspension: 'sus4' };
      expect(targetsOf(IONIAN, vSus4)[0]).toEqual(t(0, 0, 'major', 'dominant-to-tonic'));
    });

    it('gives a stack with no name no hint', () => {
      expect(likelyNextDegrees(IONIAN, shape(4, 0, 'other')).kind).toBe('none');
    });
  });

  describe('scales outside the tables', () => {
    it('refuses a seven-note scale it has no table for', () => {
      expect(likelyNextDegrees(HUNGARIAN_MINOR, shape(4)).kind).toBe('unsupported');
    });

    it('refuses a pentatonic scale before asking for a chord it cannot build', () => {
      expect(likelyNextDegrees(MAJOR_PENTATONIC, shape(0)).kind).toBe('unsupported');
    });
  });

  it('reads its inputs without writing to them', () => {
    expect(() => likelyNextDegrees(deepFrozen([...AEOLIAN]), deepFrozen(shape(3)))).not.toThrow();
  });

  describe('the two family helpers', () => {
    it('reduces sevenths and added tones to their triad', () => {
      expect(triadFamilyOf('dominant7')).toBe('major');
      expect(triadFamilyOf('minor7')).toBe('minor');
      expect(triadFamilyOf('halfDiminished7')).toBe('diminished');
      expect(triadFamilyOf('augmentedMajor7')).toBe('augmented');
      expect(triadFamilyOf('other')).toBeNull();
    });

    it('reads the key\'s own triad on a degree', () => {
      expect(triadFamilyAt(AEOLIAN, 4)).toBe('minor');
      expect(triadFamilyAt(HARMONIC_MINOR, 4)).toBe('major');
    });
  });
});
