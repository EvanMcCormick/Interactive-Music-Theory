import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  inject
} from '@angular/core';
import { Subject, distinctUntilChanged, map, takeUntil } from 'rxjs';

import { ChordPaletteComponent } from './components/chord-palette/chord-palette.component';
import { PianoRollComponent } from './components/piano-roll/piano-roll.component';
import { ProgressionNotationComponent } from './components/progression-notation/progression-notation.component';
import { ProgressionStripComponent } from './components/progression-strip/progression-strip.component';
import { ProgressionTransportComponent } from './components/progression-transport/progression-transport.component';
import { ProgressionState } from '../../models/progression.model';
import { MusicTheoryService } from '../../services/music-theory.service';
import { PROGRESSION_AUDIO, createToneApi } from '../../services/progression-audio';
import { chordRootPitchClass } from '../../services/progression-generate';
import { effectiveQuality } from '../../services/progression-harmony';
import { ProgressionPlayerService } from '../../services/progression-player.service';
import { ProgressionService } from '../../services/progression.service';

/** What the app's own selection says, reduced to the part this page reads. */
interface AppSelection {
  key: string;
  categoryId: string;
  itemId: string;
}

/**
 * The progression composer: palette, strip and transport over one key.
 *
 * ## It composes, and owns five things nothing else can
 *
 * The five components below wire themselves to `ProgressionService`, so this
 * shell passes them nothing - no inputs, no outputs, no state. The roll is the
 * clearest case rather than an exception to it: it edits whichever slot the
 * strip has selected, and it learns which that is from `selectedSlotId` on the
 * published state, not from an `@Input()` this shell would have to relay. What
 * is left is the work that only the thing owning the whole page can do:
 *
 *  1. **The key comes from the circle of fifths.** The design doc's decision:
 *     there is no key picker here because the app already has one, and the
 *     drawer in the shell is it. See `adopt` for the direction that runs and
 *     the two selections it refuses.
 *  2. **The sounding chord goes to the fretboard.** The other direction, and
 *     the only thing on this page that writes to `MusicTheoryService`. See
 *     `light`, and `restore` for the state it has to give back.
 *  3. **Ctrl+Z and Ctrl+Y.** The transport has the buttons and said why the
 *     keys are not there: a shortcut has to work with the focus anywhere on the
 *     page, which means a document-level listener, which belongs to whatever
 *     owns the page. See `onKeydown`.
 *  4. **Leaving stops playback.** See `ngOnDestroy`.
 *  5. **Edits reach the player.** `ProgressionPlayerService.play` takes a
 *     document and never looks at the service that holds it - that one-way
 *     dependency is what keeps `buildSchedule` pure arithmetic - so something
 *     has to carry each new document across for the player to swap in at the
 *     loop boundary. The transport was the other candidate and is the wrong
 *     one: it says out loud that it does not stop playback when it is
 *     destroyed, because a control being torn down is not a stop, and a
 *     transport that fed the player would stop feeding it at that moment and
 *     leave a loop running on a schedule nothing could correct. This shell
 *     cannot be in that position - it stops the player as it goes.
 *
 * ## The two directions do not form a loop
 *
 * `adopt` reads the app's selection and `light` writes it, which is a cycle on
 * paper. It is broken at `adopt`, which acts only on a selection naming a
 * *key*, and every chord `light` publishes names a chord category instead.
 * `restore` does publish a key, and reaches `adopt` - which finds the
 * progression already in that key and commits nothing, because that is the key
 * the progression adopted from it in the first place. Both halves are pinned by
 * spec, from either end.
 *
 * ## Why the audio providers are here rather than in `main.ts`
 *
 * `PROGRESSION_AUDIO` was bound in `main.ts` when the player was first built,
 * following `NOTE_DETECTOR`'s precedent, and binding a token whose factory does
 * `import * as Tone` from the entry graph is not free. Route-level `providers`
 * are the obvious fix and are not one: `Route.providers` is a static array, so
 * a factory named there is a value import from `main.ts` and Tone comes with
 * it. Only a provider written *inside* a lazily loaded file is lazy, and this
 * is that file.
 *
 * What it is worth, measured rather than assumed, because the player's own
 * comment overstated it: 722 bytes off `main`, which is
 * `progression-audio.ts` itself (772,018 with the binding in `main.ts`,
 * 771,296 with it here). The 7.6 kB
 * that comment named is Tone's `Part` and transport, and those stay: the
 * fretboard is the one eager route and does `import * as Tone`, so the `tone`
 * modules live in `main` and using two more of its exports from anywhere
 * enlarges main's copy. So this is mostly a scoping decision that happens to
 * pay for itself - the page owns its audio - and the 7.6 kB is a separate
 * question about the fretboard being eager.
 *
 * The token keeps its no-default discipline either way: a spec that reaches the
 * player without overriding one of these two fails at the injector rather than
 * quietly building a synth on a headless audio context.
 *
 * `ProgressionPlayerService` had to come with the token. A `providedIn: 'root'`
 * service is constructed *in* the root injector however it is reached, so a
 * root player would have resolved `PROGRESSION_AUDIO` against an injector this
 * page's providers are invisible to. That is not a workaround: the player owns
 * an audio chain, the page is the only thing that plays it, and the chain now
 * lives and dies with the page rather than outliving it in the root injector.
 *
 * `ProgressionService` stays at the root, deliberately. It holds the document,
 * and a document that was thrown away every time the user looked at the
 * fretboard would be a page that cannot be left.
 */
@Component({
  selector: 'app-progression',
  standalone: true,
  imports: [
    CommonModule,
    ChordPaletteComponent,
    PianoRollComponent,
    ProgressionNotationComponent,
    ProgressionStripComponent,
    ProgressionTransportComponent
  ],
  templateUrl: './progression.component.html',
  styleUrls: ['./progression.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: PROGRESSION_AUDIO, useFactory: createToneApi },
    ProgressionPlayerService
  ]
})
export class ProgressionComponent implements OnInit, OnDestroy {
  /**
   * The progression's key, spelled the way the progression spells it.
   *
   * Built here rather than in the template, per the project rule against
   * computation in a binding, and from `ProgressionState` rather than from
   * `MusicTheoryService`: this page is allowed to be in a different key from
   * the fretboard behind it, and `key.preferSharps` is the key's own answer.
   * The palette makes the same call for the same reason.
   */
  keyName = '';

  private readonly progression = inject(ProgressionService);
  private readonly musicTheory = inject(MusicTheoryService);
  private readonly player = inject(ProgressionPlayerService);
  private readonly changes = inject(ChangeDetectorRef);
  private readonly destroy$ = new Subject<void>();

  /**
   * The last state the progression published, for the cue handler to read.
   *
   * A cue names a slot id and nothing else, so turning one into a chord needs
   * the document and the key it is in. `ProgressionService` publishes its state
   * rather than exposing one synchronously - `doc` is the only getter, and the
   * chord also needs `keyScale` and `canBuildChords` - so the subscription this
   * page already had keeps the latest here. It is set before the cue
   * subscription is opened below, and `getState` is a `BehaviorSubject`, so it
   * is never null by the time a cue can arrive.
   */
  private latest: ProgressionState | null = null;

  /**
   * The user's own selection, held while the fretboard is showing a chord of
   * ours, and null when it is showing theirs.
   *
   * Doubles as the flag for which of those is true, so there is one fact rather
   * than two that can disagree. All three fields are kept: a restore that put
   * back only the key would leave the fretboard drawing a chord shape - the
   * category and the item are what decide *what* is drawn.
   */
  private restoreTo: AppSelection | null = null;

  ngOnInit(): void {
    this.progression
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.latest = state;
        // Handed over on every emission, unconditionally. The player decides
        // what to do with it - collect it for the loop boundary, or drop it
        // because it is the document already playing - and that is the right
        // place for the decision: it is the only thing that knows whether a
        // transport is running and what schedule is on it. See item 5 of the
        // class docstring for why the push comes from here.
        this.player.update(state.doc);
        this.render(state);
        this.changes.markForCheck();
      });

    this.musicTheory
      .getState()
      .pipe(
        map(
          (state): AppSelection => ({
            key: state.selectedKey,
            categoryId: state.selectedCategory,
            itemId: state.selectedItem
          })
        ),
        // The instrument, the tuning and the string count all publish on the
        // same subject, and none of them is a key change. Without this the page
        // would re-key the progression every time the user changed guitar.
        distinctUntilChanged(
          (before, after) =>
            before.key === after.key &&
            before.categoryId === after.categoryId &&
            before.itemId === after.itemId
        ),
        takeUntil(this.destroy$)
      )
      .subscribe(selection => this.adopt(selection));

    // Opened last, so that `latest` is filled before the first cue. The
    // player's subject starts empty and replays that emptiness on subscribe,
    // which lands in `light` as "nothing is sounding" and writes nothing -
    // opening the page must not move the fretboard.
    this.player.currentSlot$
      .pipe(takeUntil(this.destroy$))
      .subscribe(slotId => this.light(slotId));
  }

  /**
   * Leaving the page stops the progression.
   *
   * The transport declined this and was right to: it is a control, and a
   * control being torn down is not a stop. This is the owner - it provides the
   * player - and the case for silence is that nothing survives the navigation
   * to ask for it. There is no transport on the fretboard page, so a
   * progression still looping there is audio with no off switch; and the
   * sounding chord is published from *this* component, so a progression that
   * outlived the page would go on sounding with nothing left to light the
   * fretboard under it and nothing left to restore the user's own key when it
   * stopped.
   *
   * Said out loud rather than left to the injector. The player is destroyed
   * with this component's providers and disposes its chain then, which stops
   * the transport as a side effect - but that is a resource-cleanup mechanism
   * answering a question about behaviour, and the decision belongs where it can
   * be read and tested.
   *
   * The two lines are in this order for a reason that is easy to lose: stopping
   * empties the player's cursor, that emission is what `restore` acts on, and
   * unsubscribing first would leave the user's key overwritten by whatever
   * chord was sounding when they navigated away.
   */
  ngOnDestroy(): void {
    this.player.stop();
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Undo and redo from the keyboard.
   *
   * On the document rather than on the host, because the focus is wherever the
   * user last clicked - a chord card, the tempo box, nothing at all - and a
   * shortcut that worked only while the page element held focus would work by
   * accident.
   *
   * `Ctrl+Y` as well as `Ctrl+Shift+Z`, because Windows offers both and this
   * app runs there; `metaKey` alongside `ctrlKey` for the same reason in the
   * other direction. The key is lowered before it is compared: `Shift+Z`
   * reports `'Z'`.
   *
   * `Alt` disqualifies the press, which is not tidiness. Windows reports AltGr
   * as `ctrlKey && altKey`, so on a European layout every AltGr combination
   * looks like a Ctrl chord to the test above - and `AltGr+Z` and `AltGr+Y`
   * type real characters on several of them. Undoing instead of typing one, and
   * swallowing the keystroke on the way, is the sort of bug a user cannot even
   * describe.
   */
  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    if (event.altKey) return;
    if (isEditable(event.target)) return;

    const key = event.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;

    // Claimed before it is acted on, so that the browser's own undo does not
    // also run. Only for the two combinations that are actually handled - a
    // page that swallowed every Ctrl press would take Ctrl+A and Ctrl+C with
    // it.
    event.preventDefault();

    if (key === 'z' && !event.shiftKey) {
      this.progression.undo();
      return;
    }
    this.progression.redo();
  }

  /**
   * Takes the app's key as the progression's, when the app is naming one.
   *
   * The inbound direction. The circle sets `selectedKey` on
   * `MusicTheoryService` and knows nothing about this page, so something has to
   * carry that across, and it is this. `light` is the outbound one.
   *
   * Two selections are refused:
   *
   *  - **One that names no key.** A chord category and a fretboard display mode
   *    are both selections the user can make, and neither is a tonality:
   *    `MusicTheoryService.isKeySelection` is the single statement of that, and
   *    the chord half is also this page's own voice coming back, since `light`
   *    publishes the sounding chord as `selectKeyAndMode(root, 'triads',
   *    'minor')` and a page that adopted it would answer its own broadcast by
   *    following the chord root around.
   *  - **The key it is already in.** A key change is a commit and a commit is an
   *    undo step, so adopting a key the progression already has would cost the
   *    user one for opening the page. It is also what keeps `restore` from
   *    costing one, since it republishes exactly the key this page adopted.
   *
   * Adopting on arrival, and not only on a later change, is the deliberate half
   * of this. The drawer is app-wide and shows `selectedKey`: a progression
   * quietly in a different key from the circle floating over it would print
   * numerals for a key the diagram says the user is not in.
   *
   * ## Three fields cross, not two
   *
   * The spelling comes over as well as the pitch, and it has to: the six
   * o'clock wedge of the circle is F sharp major *and* G flat major, one pitch
   * class and two keys, and `getNoteIndex` throws away the only thing that
   * separates them. `ProgressionService.setKey` would then re-derive a
   * preference from pitch class 6 alone and find F sharp every time, because
   * that is the spelling the circle's table stores. `shouldUseSharps()` is the
   * app's own answer, read from the key *name* the user clicked, so handing it
   * over is what makes the rail agree with the fretboard and the drawer.
   *
   * It is part of the "already in this key" comparison for the same reason. F
   * sharp major and G flat major share a tonic and a scale id, so a comparison
   * of those two alone would refuse the click that moves between them - which
   * is exactly the click the split wedge exists to offer.
   */
  private adopt(selection: AppSelection): void {
    // Asked of the service rather than matched against `categoryId` here, so
    // "is this a key" has one answer in the app. It reads the state that was
    // just published - `MusicTheoryService` holds a `BehaviorSubject`, so the
    // emission being handled is the current value.
    if (!this.musicTheory.isKeySelection()) return;

    // A selection naming a key, arriving while a chord of ours is on screen,
    // is the user turning the circle mid-playback - the drawer is app-wide and
    // this page has no key picker of its own, so it is a normal thing to do.
    // What `restore` puts back has to be where they ended up: restoring the
    // selection captured when play began would undo their key change the moment
    // the music stopped, and the next emission would drag the progression back
    // with it. Cleared before `restore` publishes, so its own broadcast lands
    // here with nothing to refresh.
    if (this.restoreTo) this.restoreTo = selection;

    const tonic = this.musicTheory.getNoteIndex(selection.key);
    // -1 for a name from neither chromatic table. There is no such key today;
    // there is also no sensible pitch class to write down for one.
    if (tonic < 0) return;

    // The item id is the scale id. `isKeySelection` has already established
    // that the category is a scale category, so there is nothing left for a
    // second lookup to establish - and `setKey` is documented to survive an id
    // it cannot resolve by offering no chords rather than by throwing.
    const preferSharps = this.musicTheory.shouldUseSharps();
    const current = this.progression.doc.key;
    if (
      current.tonic === tonic &&
      current.scaleId === selection.itemId &&
      current.preferSharps === preferSharps
    ) {
      return;
    }

    this.progression.setKey(tonic, selection.itemId, preferSharps);
  }

  /**
   * Lights the fretboard with whatever is sounding now.
   *
   * The backing-track job: the progression plays behind the fretboard, and the
   * fretboard shows the chord under the user's fingers as it goes past.
   *
   * One rule covers every case, including the three where there is no chord to
   * show - the progression stopped, the slot is `literal`, the chord has no
   * name this app knows. **The fretboard shows the sounding chord while there
   * is one, and the user's own selection at every other moment.** The
   * alternative for the three refusals is to leave the previous chord lit,
   * which is a shape that is not sounding presented as one that is; going back
   * to the key is not merely honest but informative, because the chord that
   * could not be named is still built out of the key's own notes, so the scale
   * on screen contains every note being played.
   *
   * The highlight leads the sound by Tone's lookahead, about a tenth of a
   * second, because `currentSlot$` publishes from the transport callback. That
   * is the player's documented behaviour and `Tone.Draw` is the fix; it belongs
   * with the M2 playhead, where a tenth of a second is visible against a moving
   * cursor rather than on a chord shape that holds for a bar.
   */
  private light(slotId: string | null): void {
    const chord = slotId === null ? null : this.chordFor(slotId);
    if (!chord) {
      this.restore();
      return;
    }

    this.capture();
    this.musicTheory.selectKeyAndMode(chord.key, chord.categoryId, chord.itemId);
  }

  /**
   * The selection that shows a slot's chord, or null when there is none to
   * show.
   *
   * Four ways there is none, and the middle two are the same refusal the strip
   * makes when it prints no numeral on a card - one screen, one answer about
   * what this key can name:
   *
   *  - the id names no slot, which a cue from a schedule built before an edit
   *    can do;
   *  - the slot is `literal`, so it has notes and no degree. Unreachable in M1
   *    until M3's recogniser, and `replaceDocument` is the door it comes
   *    through;
   *  - the key can build no chords, so the stored quality is a leftover from
   *    whichever scale was selected when the slot was made;
   *  - the quality is `'other'`: a stack of thirds that is no named chord.
   *    Reachable today - the second degree of Hungarian minor is a major third
   *    under a diminished fifth - and there is simply no chord in
   *    `MusicTheoryService` to point at.
   *
   * `ChordQuality`'s twelve named values are chord ids in `MusicTheoryService`,
   * which is what lets the quality be handed straight to `findChordCategory`
   * and used as the item id, with no translation table in between. That
   * correspondence is written down at both ends - `progression-harmony.ts` says
   * so where the type is declared - and `findChordCategory` is also what
   * happens if it ever stops being true: an id no category holds lights
   * nothing, rather than selecting a category that does not contain it.
   *
   * The quality comes from `effectiveQuality`, which is the function the strip
   * card asks too, so the fretboard lights what the card beside it is called
   * rather than reaching its own conclusion about the same slot. That has one
   * visible consequence: a ninth is named after its seventh, so a chord raised
   * to a ninth lights the seventh - a subset of what is sounding, and the same
   * chord the card prints.
   */
  private chordFor(slotId: string): AppSelection | null {
    const state = this.latest;
    if (!state) return null;

    const slot = state.doc.slots.find(candidate => candidate.id === slotId);
    if (!slot || slot.harmony.kind !== 'degree') return null;
    if (!state.canBuildChords || !state.keyScale) return null;

    const degree = slot.harmony.degree;
    // `null` means "as the key gives it", and the fretboard wants the name
    // rather than the override - the same resolution the strip's card makes,
    // through the same function so the two cannot disagree.
    const quality = effectiveQuality(state.keyScale.intervals, degree);
    if (quality === 'other') return null;

    const category = this.musicTheory.findChordCategory(quality);
    if (!category) return null;

    const key = state.doc.key;
    return {
      // Spelled from the progression's own preference, as the palette and the
      // strip spell it, so the fretboard names the chord the way the card that
      // put it there does.
      key: this.musicTheory.spellNote(
        chordRootPitchClass(key, state.keyScale.intervals, degree),
        key.preferSharps
      ),
      categoryId: category.id,
      itemId: quality
    };
  }

  /** Remembers the user's selection, once, before the first chord covers it. */
  private capture(): void {
    if (this.restoreTo) return;

    const state = this.musicTheory.getCurrentState();
    this.restoreTo = {
      key: state.selectedKey,
      categoryId: state.selectedCategory,
      itemId: state.selectedItem
    };
  }

  /**
   * Gives the user's selection back, in one emission.
   *
   * A no-op when there is nothing held, which is the common case: the player's
   * subject replays its empty value to every new subscriber, a stop while
   * stopped publishes again, and neither is a moment at which anything was
   * overwritten.
   *
   * Cleared before it publishes rather than after. The broadcast comes straight
   * back through `adopt`, which refreshes what is held whenever something is -
   * and a field cleared afterwards would have been refreshed to the value just
   * restored, leaving the page holding a selection it no longer covers.
   */
  private restore(): void {
    const selection = this.restoreTo;
    if (!selection) return;

    this.restoreTo = null;
    this.musicTheory.selectKeyAndMode(selection.key, selection.categoryId, selection.itemId);
  }

  /** Rebuilds what is on screen from one published state. */
  private render(state: ProgressionState): void {
    const key = state.doc.key;
    const tonic = this.musicTheory.spellNote(key.tonic, key.preferSharps);

    // The scale is null only for an id the app cannot resolve, which leaves the
    // note on its own rather than printing `C undefined`.
    this.keyName = state.keyScale ? `${tonic} ${state.keyScale.name}` : tonic;
  }
}

/**
 * Whether a key press belongs to something the user is typing into.
 *
 * The tempo box is on this page, and `Ctrl+Z` inside a text box means undo the
 * typing - the browser's own, which `preventDefault` would otherwise take away.
 * `<select>` is in the list because it is a form control that reads its own key
 * presses, and `isContentEditable` because a rich-text field is neither tag.
 */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  return target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.tagName === 'SELECT';
}
