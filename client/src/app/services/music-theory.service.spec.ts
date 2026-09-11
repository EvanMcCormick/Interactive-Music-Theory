import { TestBed } from '@angular/core/testing';

import { MusicTheoryItem } from '../models/music-theory.model';
import { MusicTheoryService } from './music-theory.service';
import { isHeptatonic } from './progression-harmony';

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

    /**
     * The exemption, at the width it actually holds.
     *
     * It used to read "`F#/Gb` is the one combined name whose answer does not
     * move", and the spec under it tested ionian and passed while the sentence
     * above it was false. Six o'clock is the one position the circle carries
     * both halves of and its own `accidentalKind` is sharp, so the *ionian*
     * position does not move — which is the whole of what finding 2 claimed,
     * because finding 2 was about four majors the staff and the palette
     * disagreed on. Nineteen other items move, and the list is pinned rather
     * than the one case that agrees.
     *
     * **`lydian` is the instructive member and is not a defect.** The fourth
     * degree of D♭ major is a G♭, so `keySignatureKind('lydian', 6)` inherits
     * from D♭ and answers flat, and `Gb Ab Bb C Db Eb F` is the circle's own
     * reading of that key. Every other member is a scale `MODE_OFFSETS` does not
     * place, which falls through to its own `preferSharps` — so what the list
     * really enumerates is where the app has a flat-leaning default at this
     * pitch class, and the honest statement is not "F♯/G♭ never moves" but *the
     * circle's answer wins wherever the circle has one*.
     */
    it('leaves F#/Gb ionian sharp, and pins the nineteen items that do move', () => {
      const moved: string[] = [];

      for (const category of service.getUnifiedCategories()) {
        if (category.id === 'fretboardNotes') continue;
        for (const item of category.items) {
          service.selectKeyAndMode('F#/Gb', category.id, item.id);
          if (!service.shouldUseSharps()) moved.push(`${category.id}/${item.id}`);
        }
      }

      expect(combined('F#/Gb', 'ionian')).toBeTrue();
      expect(moved).withContext(moved.join('\n')).toEqual([
        'diatonicModes/lydian',
        'pentatonicScales/minorPentatonic',
        'bluesScales/minorBlues',
        'otherScales/diminished',
        'exoticScales/doubleHarmonic',
        'exoticScales/neapolitanMinor',
        'exoticScales/neapolitanMajor',
        'exoticScales/persian',
        'exoticScales/arabic',
        'exoticScales/japanese',
        'exoticScales/inSen',
        'exoticScales/iwato',
        'melodicMinorModes/dorianB2',
        'melodicMinorModes/locrianNat2',
        'melodicMinorModes/superLocrian',
        'harmonicMinorModes/lydianSharp2',
        'harmonicMinorModes/ultraLocrian',
        'bebopScales/bebopMinor',
        'bebopScales/bebopDorian'
      ]);
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

    /**
     * The fallback, on a spelling the app cannot choose for itself.
     *
     * **This spec used to be A♯ enigmatic**, whose sixth degree is written on an
     * F and sounds pitch class 8 — an F triple sharp, reached with no alteration
     * at all. Enigmatic inherits no signature, so the tonic came from the
     * scale's own `preferSharps`, which is `true`, and the scale printed
     * `A♯ B C𝄪 D𝄪 E𝄪 G♯ G𝄪` with the sixth degree dropping to the tables.
     *
     * It no longer does, and the change is deliberate: with no signature to
     * follow, the tonic is now whichever of the two names writes the scale most
     * simply, and B♭ writes it `Bb Cb D E F# G# A` — four accidental marks
     * against twelve, and not one degree convention cannot spell. The scale that
     * was the app's own witness for the refusal is now the clearest case for the
     * new rule, which is why the sweep below can assert that *nothing* the two
     * dropdowns can select reaches the fallback.
     *
     * So the refusal is witnessed where it is still reachable: on a root the
     * caller hands over. The ♭II of B flat major is a C♭ and a diminished
     * seventh on it stacks three minor thirds — C♭ E𝄫 G𝄫 and then a B triple
     * flat, which is not notation. The first three are spelled and the fourth
     * takes the key's own preference, which for a chord is the circle's answer
     * at B: sharp.
     */
    it('falls back for the one note a double accidental cannot reach', () => {
      service.selectKeyAndMode('B', 'seventh', 'diminished7', 'Cb');
      expect(namesInMode()).toEqual(['Cb', 'Ebb', 'Gbb', 'G#']);
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

  /**
   * The third rule for a tonic, and the one this change adds.
   *
   * Task 11 settled the first two: a single name is its own answer, a combined
   * name takes `keySignatureKind`, and neither takes the item's `preferSharps`.
   * The old name test went, but the fall-through to `preferSharps` stayed
   * reachable — and for the scales `MODE_OFFSETS` deliberately has no entry for,
   * a combined name landed on it, which is the rule `b514027` was written to
   * stop spelling keys by. The tonic letter is then wrong and the degree rule
   * compounds it across all seven letters:
   *
   * | selection | before | after |
   * |---|---|---|
   * | `F#/Gb` ultra locrian | `Gb Abb Bbb Cbb Dbb Ebb Fbb` | `F# G A Bb C D Eb` |
   * | `C#/Db` ultra locrian | `Db Ebb Fb Gbb Abb Bbb Cbb` | `C# D E F G A Bb` |
   * | `F#/Gb` persian | `Gb Abb Bb Cb Dbb Ebb F` | `F# G A# B C D E#` |
   *
   * The rule that replaces it is not a name test either: **where convention has
   * no answer, prefer the spelling that writes the scale most simply.** Both
   * names for the tonic are run through the scale's own degrees and the one
   * taking fewer accidental marks wins, sharp on a tie.
   *
   * That is why the same three rows fix `Gb` as well as `F#/Gb` without a second
   * rule. `FLAT_KEYS` holds `Gb`, so a bare `Gb` was the second way into the
   * same wrong tonic, and a measure that never reads the name cannot be fooled
   * by either.
   */
  describe('a key with no signature takes the spelling that writes it simplest', () => {
    /** Where the key's own name is the only thing that differs. */
    function inKey(key: string, categoryId: string, itemId: string): string[] {
      service.selectKeyAndMode(key, categoryId, itemId);
      return namesInMode();
    }

    it('spells the three reported selections on letters their degrees name', () => {
      expect(inKey('F#/Gb', 'harmonicMinorModes', 'ultraLocrian'))
        .toEqual(['F#', 'G', 'A', 'Bb', 'C', 'D', 'Eb']);
      expect(inKey('C#/Db', 'harmonicMinorModes', 'ultraLocrian'))
        .toEqual(['C#', 'D', 'E', 'F', 'G', 'A', 'Bb']);
      expect(inKey('F#/Gb', 'exoticScales', 'persian'))
        .toEqual(['F#', 'G', 'A#', 'B', 'C', 'D', 'E#']);
    });

    it('gives one key one spelling whichever control the user touched', () => {
      // The circle publishes `F#`, the fretboard's key dropdown publishes
      // `F#/Gb`, and `FLAT_KEYS` used to make a bare `Gb` a third answer. A
      // measure that reads the degrees rather than the name cannot tell the
      // three apart, which is the point of it.
      const throughTheCircle = inKey('F#', 'harmonicMinorModes', 'ultraLocrian');

      expect(inKey('F#/Gb', 'harmonicMinorModes', 'ultraLocrian')).toEqual(throughTheCircle);
      expect(inKey('Gb', 'harmonicMinorModes', 'ultraLocrian')).toEqual(throughTheCircle);
    });

    it('does not get a vote wherever the circle has an answer', () => {
      // F♯ lydian would be the simpler *count* — it is the sharp reading of a
      // key whose signature the circle states as flat, inherited from D♭ major.
      // The signature wins, and this is the case that says the new rule sits
      // under `keySignatureKind` rather than beside it.
      expect(inKey('F#/Gb', 'diatonicModes', 'lydian'))
        .toEqual(['Gb', 'Ab', 'Bb', 'C', 'Db', 'Eb', 'F']);
      expect(inKey('F#/Gb', 'diatonicModes', 'ionian'))
        .toEqual(['F#', 'G#', 'A#', 'B', 'C#', 'D#', 'E#']);
      expect(inKey('D#/Eb', 'diatonicModes', 'ionian'))
        .toEqual(['Eb', 'F', 'G', 'Ab', 'Bb', 'C', 'D']);
      expect(inKey('G#/Ab', 'exoticScales', 'hungarianMinor'))
        .toEqual(['G#', 'A#', 'B', 'C##', 'D#', 'E', 'F##']);
    });

    it('settles a genuine tie on sharp', () => {
      // D♯ persian writes `D# E F## G# A B C##` and E♭ persian writes
      // `Eb Fb G Ab Bbb Cb D` — six accidental marks each, and nothing in the
      // measure to separate them. Sharp is this file's standing default and is
      // the answer rather than an accident of iteration order.
      expect(inKey('D#/Eb', 'exoticScales', 'persian'))
        .toEqual(['D#', 'E', 'F##', 'G#', 'A', 'B', 'C##']);
    });
  });

  /**
   * And a chord takes the signature its own root names.
   *
   * `keySignatureKind` answers `null` for a chord id — a chord is a shape rather
   * than a tonality, so there is no mode to work back to a parent major from —
   * and that `null` was reaching the last rule, where a chord has no
   * `preferSharps` at all and every chord came back sharp. One dropdown, one
   * key, two answers:
   *
   * | key | Ionian, before and after | Major triad, before | after |
   * |---|---|---|---|
   * | `D#/Eb` | `Eb F G Ab Bb C D` | `D# F## A#` | `Eb G Bb` |
   * | `A#/Bb` | `Bb C D Eb F G A` | `A# C## E#` | `Bb D F` |
   *
   * A chord is not in a key, but its root names one, so the accidental comes
   * from the circle position for that pitch class — which is what asking
   * `keySignatureKind` for the *ionian* signature there is. No second table and
   * no new rule: the same data the scale beside it read, at the same position.
   */
  describe('a chord in a combined key spells from the circle, not from sharp', () => {
    it('agrees with the scale the same key selects', () => {
      service.selectKeyAndMode('D#/Eb', 'triads', 'major');
      expect(namesInMode()).toEqual(['Eb', 'G', 'Bb']);

      service.selectKeyAndMode('A#/Bb', 'triads', 'major');
      expect(namesInMode()).toEqual(['Bb', 'D', 'F']);
    });

    it('keeps a raised ninth out of the double sharps', () => {
      // `A#7#9` reached `B##` and `C##` off a sharp tonic. From B flat the
      // ninth is a C and the raised ninth a C sharp, which is what the chord
      // symbol says it is.
      service.selectKeyAndMode('A#/Bb', 'alterations', '7sharp9');
      expect(namesInMode()).toEqual(['Bb', 'D', 'F', 'Ab', 'C#']);
    });

    it('still spells F#/Gb sharp, because that position is sharp', () => {
      service.selectKeyAndMode('F#/Gb', 'triads', 'major');
      expect(namesInMode()).toEqual(['F#', 'A#', 'C#']);
    });

    it('leaves a natural-rooted chord exactly as it was', () => {
      service.selectKeyAndMode('B', 'seventh', 'diminished7');
      expect(namesInMode()).toEqual(['B', 'D', 'F', 'Ab']);
    });
  });

  /**
   * A `rootSpelling` is valid only with the item it arrived with.
   *
   * The guard in `note-naming.ts` tests the *pitch class*, so a spelling
   * survives any change that leaves the key where it was — and the item is the
   * other half of what a spelling is for. `updateKey` already cleared it;
   * `updateCategory` and `updateItem` enforced nothing, so a `Cb` handed over
   * for B flat major's ♭II went on renaming whatever was selected next.
   */
  describe('every writer of the selection drops the root spelling', () => {
    beforeEach(() => {
      service.selectKeyAndMode('B', 'triads', 'major', 'Cb');
      expect(namesInMode()).toEqual(['Cb', 'Eb', 'Gb']);
    });

    it('drops it when the category moves', () => {
      // B ionian, and it printed `Cb Db Eb Fb Gb Ab Bb` — every letter in flats
      // and an `F♭` among them — under a key field reading `B`.
      service.updateCategory('diatonicModes');
      expect(namesInMode()).toEqual(['B', 'C#', 'D#', 'E', 'F#', 'G#', 'A#']);
    });

    it('drops it when the item moves', () => {
      service.updateItem('minor');
      expect(namesInMode()).toEqual(['B', 'D', 'F#']);
    });

    it('drops it when the key moves', () => {
      service.updateKey('B');
      expect(namesInMode()).toEqual(['B', 'D#', 'F#']);
    });
  });

  /**
   * The regression net: every key against every item a degree can name.
   *
   * Each finding this sweep was written for was reachable by sweeping — none of
   * them needed insight, only coverage — so the sweep is the part worth keeping
   * whatever the numbers do. It is the shape
   * `progression-vocabulary.spelling.spec.ts` already uses, one layer over: that
   * one sweeps the palette's roots, this one sweeps the fretboard's degrees.
   *
   * **The class first.** Every name is on the letter its own position names: a
   * scale's nth degree n letters above the tonic, a chord tone `steps[n]`. That
   * is the property a wrong tonic breaks in all seven places at once, and it is
   * also how a drop to the chromatic tables shows up here, since a table name is
   * chosen by pitch and lands on the letter next door.
   *
   * **Then the size.** Notes written on a double accidental are counted because
   * that is what a wrong tonic inflates: `F#/Gb` ultra locrian alone carried six
   * of them before this change, and the whole menu carried **292 notes across
   * 172 selections, 73 of them carrying two or more and that one as high as
   * six**, where it now carries **77 notes across 69 selections, 8 of them
   * carrying two, none above two**. The cap is the assertion that would fail
   * loudest — no selection either dropdown can make needs more than two.
   *
   * Both halves of that sentence used to say "across" and then quote the count
   * of selections carrying *two or more* — "292 across 73", "77 across 8" — and
   * arithmetic falsifies the second on sight: eight selections holding at most
   * two doubles cannot carry 77 notes. The figures were all real and the word
   * joining them was wrong. `doubles` below is the array collecting the `>= 2`
   * rows, so 73 and 8 are what it held; 172 and 69 are the rows carrying any at
   * all, which is what "across" claims. Re-measured against this sweep at both
   * commits rather than copied from the note that reported them.
   *
   * The one off-letter name the sweep found before this change was `A♯/B♭`
   * enigmatic's sixth degree, which is the drop to the tables that the new tonic
   * rule removes. There are none left.
   */
  describe('the whole menu, swept', () => {
    const KEYS = [
      'C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'
    ];

    const LETTERS = 'CDEFGAB';

    /** Items `noteName` can spell at all: seven degrees, or a chord's steps. */
    function degreeSpelled(item: MusicTheoryItem): boolean {
      return item.steps ? item.steps.length === item.intervals.length : isHeptatonic(item.intervals);
    }

    /** One entry per selection: its names, and how many carry a double. */
    function sweep(): { describe: string; names: string[]; item: MusicTheoryItem }[] {
      const rows: { describe: string; names: string[]; item: MusicTheoryItem }[] = [];

      for (const category of service.getUnifiedCategories()) {
        if (category.id === 'fretboardNotes') continue;

        for (const item of category.items) {
          if (!degreeSpelled(item)) continue;

          for (const key of KEYS) {
            service.selectKeyAndMode(key, category.id, item.id);
            rows.push({ describe: `${key} ${item.id}`, names: namesInMode(), item });
          }
        }
      }

      return rows;
    }

    it('names every note on the letter its own position names', () => {
      const wrong: string[] = [];

      for (const row of sweep()) {
        const tonic = LETTERS.indexOf(row.names[0].charAt(0));

        row.names.forEach((name, position) => {
          const step = row.item.steps ? row.item.steps[position] : position;
          const expected = LETTERS.charAt((tonic + step) % 7);
          if (name.charAt(0) !== expected) {
            wrong.push(`${row.describe}: ${name} at ${step} steps, expected ${expected}`);
          }
        });
      }

      expect(wrong).withContext(wrong.join('\n')).toEqual([]);
    });

    it('writes 77 notes on a double accidental, and never more than two at once', () => {
      const doubles: string[] = [];
      let marks = 0;

      for (const row of sweep()) {
        const needed = row.names.filter(name => name.length === 3);
        marks += needed.length;
        if (needed.length >= 2) doubles.push(`${row.describe}: ${row.names.join(' ')}`);
      }

      expect(marks).toBe(77);

      // The worst the menu holds, disclosed rather than merely bounded, because
      // pinning only the best case is how "nobody looked" passes for "somebody
      // decided". Every one of the eight is a selection whose tonic had no
      // second spelling worth taking: the two hungarian minors and the three
      // diminished sevenths are the circle's own answer for their key, `D#/Eb`
      // persian is a tie, and `B` enigmatic and `F` ultra locrian are rooted on
      // a natural, which has one spelling and not two.
      expect(doubles).withContext(doubles.join('\n')).toEqual([
        'D#/Eb hungarianMinor: D# E# F# G## A# B C##',
        'G#/Ab hungarianMinor: G# A# B C## D# E F##',
        'B enigmatic: B C D# E# F## G## A#',
        'D#/Eb persian: D# E F## G# A B C##',
        'F ultraLocrian: F Gb Ab Bbb Cb Db Ebb',
        'C#/Db diminished7: Db Fb Abb Cbb',
        'D#/Eb diminished7: Eb Gb Bbb Dbb',
        'G#/Ab diminished7: Ab Cb Ebb Gbb'
      ]);
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
