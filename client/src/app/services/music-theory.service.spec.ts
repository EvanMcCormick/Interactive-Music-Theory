import { TestBed } from '@angular/core/testing';

import { MusicTheoryService } from './music-theory.service';

/**
 * How the app decides to spell notes.
 *
 * `shouldUseSharps` is consulted for every note the fretboard and keyboard draw,
 * so it is the single decision behind whether a user sees F♯ or G♭ — and it was
 * getting minor keys wrong in a way nothing noticed until the circle of fifths
 * made them reachable in one click.
 *
 * **A key signature is a property of the key, not of the mode.** E minor has one
 * sharp because its relative major is G. Deciding from a per-scale
 * `preferSharps` default instead meant every natural-rooted minor got the same
 * answer regardless of which minor it was: E minor came back spelled with G♭
 * where its own signature says F♯.
 */
describe('MusicTheoryService spelling', () => {
  let service: MusicTheoryService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MusicTheoryService);
  });

  /** Puts the service in a key and mode, the way the circle does. */
  function select(key: string, item: string): void {
    service.selectKeyAndMode(key, 'diatonicModes', item);
  }

  describe('minor keys follow their own signature', () => {
    it('spells E minor with sharps, because its relative major is G', () => {
      select('E', 'aeolian');
      expect(service.shouldUseSharps()).toBeTrue();
    });

    it('spells B minor with sharps: two, from D major', () => {
      select('B', 'aeolian');
      expect(service.shouldUseSharps()).toBeTrue();
    });

    it('spells D minor with flats: one, from F major', () => {
      select('D', 'aeolian');
      expect(service.shouldUseSharps()).toBeFalse();
    });

    it('spells G minor with flats: two, from B flat major', () => {
      select('G', 'aeolian');
      expect(service.shouldUseSharps()).toBeFalse();
    });

    it('spells C minor with flats: three, from E flat major', () => {
      select('C', 'aeolian');
      expect(service.shouldUseSharps()).toBeFalse();
    });
  });

  describe('the other modes too, for the same reason', () => {
    it('spells E dorian with sharps, from D major', () => {
      select('E', 'dorian');
      expect(service.shouldUseSharps()).toBeTrue();
    });

    it('spells D dorian either way, because C major has no accidentals', () => {
      // Nothing to get wrong and nothing to assert beyond "it does not throw":
      // a signature of zero carries no preference, so the scale's own default
      // is still what decides.
      select('D', 'dorian');
      expect(typeof service.shouldUseSharps()).toBe('boolean');
    });

    it('spells A mixolydian with sharps, from D major', () => {
      select('A', 'mixolydian');
      expect(service.shouldUseSharps()).toBeTrue();
    });
  });

  describe('what has not changed', () => {
    it('still spells a major key from its own name', () => {
      select('C', 'ionian');
      expect(service.shouldUseSharps()).toBeTrue();

      select('A', 'ionian');
      expect(service.shouldUseSharps()).toBeTrue();
    });

    it('still lets an explicitly flat key name win', () => {
      select('Eb', 'ionian');
      expect(service.shouldUseSharps()).toBeFalse();

      select('Gb', 'ionian');
      expect(service.shouldUseSharps()).toBeFalse();
    });

    it('still lets an explicitly sharp key name win', () => {
      select('F#', 'ionian');
      expect(service.shouldUseSharps()).toBeTrue();
    });

    it('leaves non-diatonic scales to their own preference', () => {
      // A pentatonic or blues scale has no parent major to read a signature
      // from, so nothing here should be inventing one for it.
      const before = service.getCurrentState();
      service.updateCategory('pentatonicScales');

      expect(typeof service.shouldUseSharps()).toBe('boolean');
      expect(service.getCurrentState().selectedKey).toBe(before.selectedKey);
    });
  });

  describe('selectKeyAndMode', () => {
    it('sets key, category and item in one emission', () => {
      let emissions = 0;
      const sub = service.getState().subscribe(() => emissions++);

      // One for the current value on subscribe, then one for the change.
      emissions = 0;
      service.selectKeyAndMode('Bb', 'diatonicModes', 'aeolian');
      sub.unsubscribe();

      const state = service.getCurrentState();
      expect(state.selectedKey).toBe('Bb');
      expect(state.selectedCategory).toBe('diatonicModes');
      expect(state.selectedItem).toBe('aeolian');
      expect(emissions).toBe(1);
    });
  });
});
