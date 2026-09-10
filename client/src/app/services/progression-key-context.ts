import { Scale } from '../models/music-theory.model';
import { ProgressionKey } from '../models/progression.model';
import { keySignatureKind } from './circle-of-fifths.data';
import { MusicTheoryService } from './music-theory.service';
import { isHeptatonic } from './progression-harmony';

/**
 * How a key id becomes a scale, and what the resolved scale is then allowed to
 * decide: whether chords can be built through it at all, which intervals they
 * are built from, and how the key spells its notes.
 *
 * `ProgressionKey.scaleId` is an id into `MusicTheoryService`'s tables, and the
 * loop below is the only place this feature's source reads them - the other
 * callers of `getScaleCategories` are all specs, and they are doing the
 * opposite thing. They enumerate the tables to sweep an invariant over every
 * scale the app offers, or reach into them for three named ones to check the
 * borrowed chords still track them: assertions *about* the tables, not a key
 * being resolved. Everything above takes a `Scale | null` or a
 * `readonly number[] | null` back and never asks where it came from, so the
 * shape of those tables is a fact about one file rather than about the service,
 * the store and the editor together.
 *
 * ## Why it is a thing with a name rather than five private methods
 *
 * Two collaborators already reach back into `ProgressionService` for exactly
 * this. `ProgressionStore` borrows `derive` because `ProgressionState` carries
 * `keyScale` and `canBuildChords` and a store that worked them out for itself
 * would have put the resolution of a scale id inside the undo stack.
 * `ProgressionNoteEditor` is next: recognising a chord from the notes a user
 * wrote needs the scale to express it in, and the plan hands the editor a
 * callback for the same reason. Two arrows into the service asking one
 * question is the shape of a thing that has not been named yet.
 *
 * Naming it also means each callback can be a bound method of this rather than
 * a closure over the whole service. Hand a collaborator one of these and it has
 * the question it needs and no route back to `commit`, `selectSlot` or the undo
 * stack - which is what the editor should be given in Task 9, one method rather
 * than the object, since a scale to express a chord in is all it is owed.
 *
 * ## Plain, not injectable, and handed its dependency
 *
 * `ProgressionService` constructs one, keeps it private, and delegates. The
 * reason is `ProgressionStore`'s and `ProgressionNoteEditor`'s: the service is
 * the one door, and an injectable here would be a second one - a component
 * could resolve a scale without going through the service that owns the key.
 *
 * `MusicTheoryService` arrives as a constructor argument rather than through an
 * `inject()` of its own, which is what keeps this constructible from a spec
 * with no injector standing up around it - `progression-key-context.spec.ts`
 * builds one with a bare `new` and no `TestBed` around it, so the claim is held
 * rather than merely made. It is also the whole of what this class can see, and
 * it is not even kept: the constructor reads the scale tables into `scalesById`
 * and lets go. There is no path from here back to the document.
 *
 * ## What stayed in the service
 *
 * `derive` builds the whole of `ProgressionState`, and only two of its seven
 * fields are key-to-scale knowledge. The other five are the store's numbers and
 * the selection validated against the slots, which is not this file's business
 * and would arrive here only because it happened to be in the same method. So
 * `derive` stays where the store borrows it from and asks the two questions
 * below.
 *
 * `regenerate` stayed for a sharper reason. It composes `regenerateSlot` with
 * whatever `chordScaleFor` answers, and `regenerateSlot` merges notes,
 * ownership and voicing - slot knowledge, not key knowledge. Moving it would
 * have made this class the place a slot is rebuilt as well as the place a scale
 * is found, and it would have put a path to regeneration inside the object
 * Task 9 hands the note editor. The seam that kept `resetSlotToChord` in the
 * service is the same seam, and it only holds while this file cannot rebuild a
 * chord.
 */
export class ProgressionKeyContext {
  /**
   * Every scale the app offers, by id, flattened out of the categories once.
   *
   * `findScale` was a scan of every category and every scale in it, and `derive`
   * calls it on **every publish** - every commit, every selection change, every
   * undo - which was as true before this class existed as after. What changed is
   * that the tables are now one file's business, so the fix is local: build the
   * index here and the scan is gone from the whole feature.
   *
   * Building it once is only safe because `MusicTheoryService`'s scale
   * categories are reference data - a field initializer, never appended to,
   * never replaced, and `getScaleCategories` is the only way in. If a scale ever
   * becomes addable at runtime this map goes stale silently, and the honest
   * repair is to drop it rather than to invalidate it.
   *
   * First id wins, which is what the scan did. No id is currently repeated
   * across the categories, so nothing depends on the tie-break; keeping it means
   * a future repeat cannot change which scale resolves.
   */
  private readonly scalesById = new Map<string, Scale>();

  constructor(musicTheory: MusicTheoryService) {
    for (const category of musicTheory.getScaleCategories()) {
      for (const scale of category.scales) {
        if (!this.scalesById.has(scale.id)) this.scalesById.set(scale.id, scale);
      }
    }
  }

  /**
   * The scale a key names, or null when the id names nothing the app knows.
   *
   * `ProgressionKey.scaleId` is an id from `MusicTheoryService` and this is the
   * one place that resolves it, so an id that does not resolve produces a page
   * with no chords to offer rather than an exception somewhere downstream.
   */
  findScale(scaleId: string): Scale | null {
    return this.scalesById.get(scaleId) ?? null;
  }

  /**
   * The intervals a scale can stack thirds through, or null when it cannot.
   *
   * Two questions with one answer: whether the palette may offer a chord, and
   * what `regenerateSlot` builds one from. An unknown id and a scale that is
   * not heptatonic answer both, asked once so the two cannot drift.
   *
   * It takes the resolved scale rather than the key so that
   * `ProgressionService.derive` can ask it about the scale it has already
   * looked up; `chordScaleFor` below is the same question asked from a key, for
   * the callers that have one. The heptatonic rule is stated here and nowhere
   * else, which is the property worth keeping.
   */
  chordScale(scale: Scale | null): readonly number[] | null {
    return scale && isHeptatonic(scale.intervals) ? scale.intervals : null;
  }

  /**
   * The same answer from a key rather than from a scale already in hand.
   *
   * The composition - resolve the id, then ask whether thirds stack through
   * what comes back - is written once here rather than at each of the callers
   * that hold a key, which is what stops the resolution from being spelled out
   * in a file that is not supposed to know how it works. `regenerate` and
   * `canBuildChords` are both this, read for different halves of the answer.
   */
  chordScaleFor(key: ProgressionKey): readonly number[] | null {
    return this.chordScale(this.findScale(key.scaleId));
  }

  /** Whether thirds can be stacked through the key's scale at all. */
  canBuildChords(key: ProgressionKey): boolean {
    return this.chordScaleFor(key) !== null;
  }

  /**
   * How the new key spells its notes: its own signature, then the scale's
   * default, then whatever was already in force.
   *
   * The first clause is the one that matters and it is `b514027`'s rule, called
   * rather than restated - E flat ionian carries three flats however the ionian
   * scale's `preferSharps` is set, and it is set to `true`. Reading that flag
   * first was how the palette came to print `D♯ Maj` in E flat major.
   *
   * The second clause is not a fallback from failure but the honest answer for
   * a scale with no parent major: a pentatonic has no signature to inherit, so
   * the only opinion available is the one it declares for itself. The third is
   * for an id the app cannot resolve at all - there is no scale to ask, and
   * guessing would be worse than keeping.
   *
   * It takes the resolved scale rather than resolving the id itself so that
   * `setKey`, which looks the scale up before it opens its commit, is not made
   * to look it up twice.
   */
  spellingFor(tonic: number, scaleId: string, scale: Scale | null, inForce: boolean): boolean {
    const signature = keySignatureKind(scaleId, tonic);
    if (signature === 'sharp') return true;
    if (signature === 'flat') return false;

    return scale ? scale.preferSharps : inForce;
  }
}
