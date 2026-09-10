import { TestBed } from '@angular/core/testing';

import { MusicTheoryService } from './music-theory.service';

/**
 * How the app decides to spell notes, in the two questions it takes.
 *
 * **Sharps or flats**, which is `shouldUseSharps`. Consulted for every note the
 * fretboard and keyboard draw, so it is the single decision behind whether a
 * user sees F♯ or G♭ — and it was getting minor keys wrong in a way nothing
 * noticed until the circle of fifths made them reachable in one click.
 *
 * **A key signature is a property of the key, not of the mode.** E minor has one
 * sharp because its relative major is G. Deciding from a per-scale
 * `preferSharps` default instead meant every natural-rooted minor got the same
 * answer regardless of which minor it was: E minor came back spelled with G♭
 * where its own signature says F♯.
 *
 * **Which letter**, which is `noteNameFor`. A preference chooses between two
 * names for one pitch class and cannot choose a letter, so no answer to the
 * first question could ever have stopped F locrian printing `G♯` for its A flat.
 * A degree has a letter; so does a place in a chord. See `note-naming.ts`.
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

  /** What the selection's own notes are called, in the order it stacks them. */
  function namesInMode(): string[] {
    return service.generateModeNotes().map(note => service.noteNameFor(note));
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

  /**
   * Finding 2 of the M2 review, fixed.
   *
   * Every combined name in `chromaticScaleWithBoth` carries both spellings, so
   * every one of them contains a `#`, and a rule testing for `#` before `b`
   * brought all five back sharp. Selecting `D#/Eb` with ionian gave a circle
   * wedge reading "Eb", a fretboard reading "D#", and an engraved signature of
   * `fifths: -3` — E flat major.
   *
   * The circle already holds the answer as data, and holds a *better* one than
   * any rule reading the name could: the four keys below do not all resolve the
   * same way, and which way each goes depends on the mode as well as the tonic.
   */
  describe('a combined key name settles nothing, so its signature decides', () => {
    /** Puts the service in a key and mode without going through `select`. */
    function combined(key: string, item: string): boolean {
      service.selectKeyAndMode(key, 'diatonicModes', item);
      return service.shouldUseSharps();
    }

    it('spells the four disagreeing majors in flats, as the staff engraves them', () => {
      // Eb (3♭), Bb (2♭), Ab (4♭), Db (5♭). Their sharp spellings are D♯ major
      // at nine sharps, A♯ at ten, G♯ at eight and C♯ at seven — only the last
      // is a key anyone writes, and none of them is on the circle.
      expect(combined('D#/Eb', 'ionian')).toBeFalse();
      expect(combined('A#/Bb', 'ionian')).toBeFalse();
      expect(combined('G#/Ab', 'ionian')).toBeFalse();
      expect(combined('C#/Db', 'ionian')).toBeFalse();
    });

    it('leaves F#/Gb major sharp, which is that circle position\'s own answer', () => {
      // Six o'clock is the one position the circle carries both halves of, and
      // its `accidentalKind` is sharp. The only combined name whose answer does
      // not move, and it does not move because of data rather than luck.
      expect(combined('F#/Gb', 'ionian')).toBeTrue();
    });

    it('splits the same four the other way in aeolian, where the counts differ', () => {
      // G♯ minor has five sharps against A♭ minor's seven, so it goes sharp;
      // B♭ minor has five flats against A♯ minor's seven, so it goes flat. A
      // rule reading the name could not tell those two apart in either
      // direction, and the old one got both wrong.
      expect(combined('G#/Ab', 'aeolian')).toBeTrue();
      expect(combined('C#/Db', 'aeolian')).toBeTrue();
      expect(combined('A#/Bb', 'aeolian')).toBeFalse();
    });

    it('still lets a single name decide for itself', () => {
      // `Gb` is what the circle's split wedge actually publishes, and a name
      // with one spelling in it is its own answer.
      expect(combined('F#', 'ionian')).toBeTrue();
      expect(combined('Gb', 'ionian')).toBeFalse();
    });
  });

  /**
   * The second question: which letter.
   *
   * An in-scale note is written on the letter its degree names and a chord tone
   * on the letter its place in the chord names, so the fretboard and the
   * keyboard now spell what the composer spells, by the same arithmetic.
   */
  describe('names a note by the letter its degree gives it', () => {
    it('spells E flat major in flats, and on seven different letters', () => {
      // The half of finding 2 that made fixing it non-optional: degree letters
      // are only as right as the tonic's, and off a D♯ tonic these seven would
      // have printed D♯ E♯ F𝄪 G♯ A♯ B♯ C𝄪 — worse than the D♯ F G A♯ C D D♯
      // the tables gave.
      service.selectKeyAndMode('D#/Eb', 'diatonicModes', 'ionian');
      expect(namesInMode()).toEqual(['Eb', 'F', 'G', 'Ab', 'Bb', 'C', 'D']);
    });

    it('spells F locrian with an A flat and a C flat, not a G sharp and a B', () => {
      // F locrian is the G flat major scale from its fourth degree, so every
      // degree but the tonic is flat and the seventh letter is a C. The tables
      // hold no C♭ at all, which is the limit no preference could have reached.
      select('F', 'locrian');
      expect(namesInMode()).toEqual(['F', 'Gb', 'Ab', 'Bb', 'Cb', 'Db', 'Eb']);
    });

    it('spells a diminished seventh on B with an A flat, because 9 is a seventh here', () => {
      // Four stacked minor thirds, so every note is a rung: B is the root, D
      // the third, F the fifth and the ninth semitone the *seventh*. A minor
      // seventh above B is A, so a diminished one is A♭ — the same nine
      // semitones the `6` chord writes as a sixth. `steps` is what settles it.
      service.selectKeyAndMode('B', 'seventh', 'diminished7');
      expect(namesInMode()).toEqual(['B', 'D', 'F', 'Ab']);
    });

    it('spells a chord from the root spelling its caller hands over', () => {
      // The ♭II of B flat major, which is where the twelve names run out: its
      // root is a C flat, and the fretboard spells the third and the fifth from
      // that letter rather than from the `B` the key field has to carry.
      service.selectKeyAndMode('B', 'triads', 'major', 'Cb');
      expect(namesInMode()).toEqual(['Cb', 'Eb', 'Gb']);
    });

    it('reaches the formula and the fretboard, not only the mode notes', () => {
      service.selectKeyAndMode('D#/Eb', 'diatonicModes', 'ionian');
      expect(service.getFormulaAsNotes()).toBe('Eb - F - G - Ab - Bb - C - D');

      select('F', 'locrian');
      const strings = service.generateFretboard();
      const names = strings[0].map(note => note.noteName);
      expect(names).toContain('Ab');
      expect(names).not.toContain('G#');
    });

    it('reaches the keyboard as well', () => {
      service.updateInstrument('piano');
      select('F', 'locrian');

      const names = service.generateKeyboard().map(key => key.noteName);
      expect(names).toContain('Cb');
      expect(names).not.toContain('B');
    });
  });

  /**
   * Where the letters run out, and why none of it is a failure.
   *
   * Each case below has no degree to take a letter from, or no letter that a
   * double accidental can reach. The chromatic tables answer, and the answer is
   * the honest floor rather than a fallback that lost something better.
   */
  describe('and keeps the tables where a degree cannot name one', () => {
    it('leaves a note outside the scale to the key', () => {
      service.selectKeyAndMode('D#/Eb', 'diatonicModes', 'ionian');

      // Pitch class 1 is no degree of E flat major, so there is no letter it is
      // written on — but the key still says flats, which is finding 2 reaching
      // the fallback as well as the degrees.
      expect(service.noteNameFor(1)).toBe('Db');
    });

    it('leaves a pentatonic alone: five degrees cannot take seven letters', () => {
      service.selectKeyAndMode('B', 'pentatonicScales', 'majorPentatonic');
      expect(namesInMode()).toEqual(['B', 'C#', 'D#', 'F#', 'G#']);
    });

    it('leaves a bebop scale alone: eight notes will not fit either', () => {
      service.selectKeyAndMode('F', 'bebopScales', 'bebopDominant');
      expect(namesInMode()).toEqual(['F', 'G', 'A', 'Bb', 'C', 'D', 'Eb', 'E']);
    });

    it('leaves the explicit sharp and flat views exactly as selected', () => {
      // The one place a key name must not win. "All Notes (Sharps)" is an
      // instruction about which accidentals to draw, and the key beside it —
      // whose signature now says flats — may not overrule it.
      service.selectKeyAndMode('D#/Eb', 'fretboardNotes', 'allNotesSharp');
      expect(service.noteNameFor(3)).toBe('D#');

      service.selectKeyAndMode('D#/Eb', 'fretboardNotes', 'allNotesFlat');
      expect(service.noteNameFor(3)).toBe('Eb');
    });

    it('falls back for the one degree a double accidental cannot reach', () => {
      // A♯ enigmatic's sixth degree is written on an F and sounds pitch class
      // 8 — an F triple sharp, which is not notation. It is reached with no
      // alteration at all, which is why `spellAt` refuses rather than clamping.
      // The other six degrees are spelled, doubles and all.
      service.selectKeyAndMode('A#', 'exoticScales', 'enigmatic');
      expect(namesInMode()).toEqual(['A#', 'B', 'C##', 'D##', 'E##', 'G#', 'G##']);
    });

    it('ignores a root spelling that does not name the key it arrived with', () => {
      // What keeps a spelling left behind by a chord that has stopped sounding
      // from renaming a key it has nothing to do with.
      service.selectKeyAndMode('C', 'triads', 'major', 'Cb');
      expect(namesInMode()).toEqual(['C', 'E', 'G']);
    });

    it('forgets the root spelling when the key moves under it', () => {
      service.selectKeyAndMode('B', 'triads', 'major', 'Cb');
      service.updateKey('B');
      expect(namesInMode()).toEqual(['B', 'D#', 'F#']);
    });

    it('forgets it again when the next selection carries none', () => {
      service.selectKeyAndMode('B', 'triads', 'major', 'Cb');
      service.selectKeyAndMode('B', 'triads', 'major');
      expect(namesInMode()).toEqual(['B', 'D#', 'F#']);
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
