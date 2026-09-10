import { ProgressionKey } from '../models/progression.model';
import { MusicTheoryService } from './music-theory.service';
import { ProgressionKeyContext } from './progression-key-context';

/**
 * The class's header claims that taking `MusicTheoryService` as a constructor
 * argument, rather than reaching for an `inject()` of its own, "keeps this
 * constructible from a spec with no injector standing up around it". Nothing
 * demonstrated that, so the claim was only an intention.
 *
 * Every `new` below is the demonstration: no `TestBed`, no `configureTesting-
 * Module`, no provider. `MusicTheoryService` is `providedIn: 'root'` but its
 * constructor takes nothing and only builds its own tables, so it comes up bare
 * as well. Task 9 hands the note editor one of these objects and will want to
 * test the editor the same way, which is what makes the property worth pinning
 * rather than merely observing.
 */
describe('ProgressionKeyContext', () => {
  const keys = new ProgressionKeyContext(new MusicTheoryService());

  function keyOf(scaleId: string): ProgressionKey {
    return { tonic: 0, scaleId, preferSharps: true };
  }

  // An id from a saved document that this build no longer knows: no scale, and
  // so a page with no chords to offer rather than an exception downstream.
  it('resolves nothing for an id the app does not know', () => {
    expect(keys.findScale('notAScale')).toBeNull();
    expect(keys.canBuildChords(keyOf('notAScale'))).toBeFalse();
  });

  // Resolving and being usable are two questions, and this is the case that
  // separates them: five notes are a real scale but thirds cannot stack through
  // them, so the scale is found and the chord scale is still refused.
  it('resolves a pentatonic but refuses to stack thirds through it', () => {
    const pentatonic = keys.findScale('majorPentatonic');

    expect(pentatonic).not.toBeNull();
    expect(pentatonic!.intervals.length).toBe(5);
    expect(keys.chordScale(pentatonic)).toBeNull();
    expect(keys.canBuildChords(keyOf('majorPentatonic'))).toBeFalse();
  });

  it('gives a heptatonic scale its own intervals to build chords from', () => {
    expect(keys.chordScaleFor(keyOf('ionian'))).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(keys.canBuildChords(keyOf('ionian'))).toBeTrue();
  });

  // `b514027`'s rule: a key signature belongs to the key, not to the scale
  // shape. E flat ionian carries three flats however the ionian scale's own
  // `preferSharps` is set - and it is set to `true`, which is how the palette
  // came to print `D♯ Maj` as the tonic chord of E flat major.
  it("spells E flat ionian flat, against the scale's own preference", () => {
    const ionian = keys.findScale('ionian');

    expect(ionian!.preferSharps).toBeTrue();
    expect(keys.spellingFor(3, 'ionian', ionian, true)).toBeFalse();
  });

  // The third clause of the same method, and the reason it is a clause: a
  // pentatonic inherits no signature, so its own declared preference is the
  // only opinion there is to have.
  it("falls back to the scale's own preference where there is no signature", () => {
    const pentatonic = keys.findScale('minorPentatonic');

    expect(pentatonic!.preferSharps).toBeFalse();
    expect(keys.spellingFor(0, 'minorPentatonic', pentatonic, true)).toBeFalse();
  });
});
