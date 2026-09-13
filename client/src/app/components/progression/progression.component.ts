import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ErrorHandler,
  HostListener,
  OnDestroy,
  OnInit,
  inject
} from '@angular/core';
import { Router } from '@angular/router';
import * as alphaTab from '@coderline/alphatab';
import { Subject, distinctUntilChanged, map, takeUntil } from 'rxjs';

import { ChordPaletteComponent } from './components/chord-palette/chord-palette.component';
import { PianoRollComponent } from './components/piano-roll/piano-roll.component';
import { ProgressionNotationComponent } from './components/progression-notation/progression-notation.component';
import { ProgressionStripComponent } from './components/progression-strip/progression-strip.component';
import { ProgressionTransportComponent } from './components/progression-transport/progression-transport.component';
import { ProgressionState } from '../../models/progression.model';
import { findChordByIntervals } from '../../services/chord-catalog';
import { ComposerExportService } from '../../services/composer-export.service';
import { ComposerService } from '../../services/composer.service';
import { errorOf } from '../../services/error-message';
import { MusicTheoryService } from '../../services/music-theory.service';
import { PROGRESSION_AUDIO, createToneApi } from '../../services/progression-audio';
import { chordRootPitchClass } from '../../services/progression-generate';
import { effectiveChord } from '../../services/progression-harmony';
import { ProgressionPlayerService } from '../../services/progression-player.service';
import {
  MAX_PREVIEW_BARS,
  PROGRESSION_FINEST_DIVISION,
  progressionToScore
} from '../../services/progression-score';
import { chordRootName } from '../../services/progression-spelling';
import {
  generatedTrackState,
  progressionLabel,
  progressionTrack
} from '../../services/progression-track';
import { ProgressionService } from '../../services/progression.service';
import { ScoreDocMapperService } from '../../services/score-doc-mapper.service';

/** What the app's own selection says, reduced to the part this page reads. */
interface AppSelection {
  key: string;
  categoryId: string;
  itemId: string;

  /**
   * How this page spells that key, where a table name cannot.
   *
   * Outbound only. `chordFor` fills it because a chord root here can be a `C♭`,
   * and `key` beside it has to stay one of the twelve names `getNoteIndex`
   * compares against. Absent on everything captured from the app, which is what
   * makes `restore` hand back a selection with no spelling attached to it.
   */
  rootSpelling?: string;
}

/**
 * The progression composer: palette, strip and transport over one key.
 *
 * ## It composes, and owns seven things nothing else can
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
 *  6. **The progression leaves as a file.** The rail's Export block, and
 *     `exportMidi` / `exportGuitarPro` below. It sits here rather than in the
 *     notation panel because it does not need one: `ComposerExportService`
 *     gained `toMidi`, so neither export asks for a rendering alphaTab
 *     instance, and a user should not have to learn that opening a preview is
 *     what unlocks a download.
 *  7. **The progression leaves as a track.** `send` below, the third control in
 *     that block. It is the same projection the exports run, handed to
 *     `ComposerService` instead of to a file - and then the page navigates, so
 *     it has to be the page that does it. See `send` for what it refuses and
 *     why the button renames itself.
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

  /**
   * What the last thing the rail's block tried to do has to say, or null when
   * nothing has spoken.
   *
   * One field for all three buttons, because only one of them can be acting at
   * a time and a user reading a refusal should not have to work out which of
   * three places it will appear in. What that costs is that every path writing
   * it has to say which button it came from, and every path that succeeds has
   * to clear it; both halves are pinned by spec.
   *
   * Not always a refusal. A send that committed and then failed to navigate
   * writes here too, and says the opposite of the refusals around it - the
   * track arrived. See `leave`.
   *
   * Cleared by the next attempt that succeeds, and not by an edit: an error
   * that vanished on the keystroke after it was raised is an error the user has
   * to have been looking at to read.
   */
  exportError: string | null = null;

  /**
   * `exportError` as the rail's two live regions hold it: in one of them, with
   * the other empty.
   *
   * Two regions, both always in the page, because `role="alert"` announces a
   * *change inside* a region rather than the presence of text in one. Export
   * MIDI and then Export .gp on an over-long progression produce byte-identical
   * sentences, so a single region behind an `*ngIf` mutated nothing on the
   * second press and a screen-reader user perceived nothing at all. `showError`
   * swaps them on every message, which makes a repeat a change in both.
   */
  alerts: readonly [string, string] = ['', ''];

  /**
   * What the Send button says, which is what pressing it will do.
   *
   * `ComposerService.sendProgression` merges rather than appending, so the
   * second press refreshes the track the first one wrote rather than adding
   * another - the button says so rather than promising a second track it does
   * not deliver. `generatedTrackState` is the one place that rule is written,
   * and the Composer's own tracks panel reads the same function.
   *
   * Only the two answers, not three. `generatedTrackState` also distinguishes
   * a current track from a stale one, and this deliberately does not: the badge
   * that says which is in the Composer, beside the track, and a button here
   * that read `Refresh` versus `Already there` would be reporting on a document
   * the user is not looking at.
   */
  sendLabel = 'Send to Composer';

  private readonly progression = inject(ProgressionService);
  private readonly musicTheory = inject(MusicTheoryService);
  private readonly player = inject(ProgressionPlayerService);
  private readonly exporter = inject(ComposerExportService);
  private readonly composer = inject(ComposerService);
  private readonly mapper = inject(ScoreDocMapperService);
  private readonly router = inject(Router);
  private readonly errors = inject(ErrorHandler);
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
   * The revision the rail's last message was written about.
   *
   * Null until the first publish, which is why `forgetStaleMessage` requires a
   * previous value rather than treating the first emission as a move: nothing
   * can be showing before the page has a document.
   */
  private messageRevision: number | null = null;

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
        this.forgetStaleMessage(state);
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

    // The Send button's label is a fact about the *Composer's* document, which
    // this page does not own and does not otherwise read: a track flattened or
    // removed over there has to reach the button here. `ComposerService`
    // publishes a `BehaviorSubject`, so this also settles the label on load.
    this.composer
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.refreshSendLabel();
        this.changes.markForCheck();
      });

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
   * Hands the progression to the Composer as a track, and follows it there.
   *
   * The third door out of the rail's block, and the only one whose result stays
   * in the app. It is the same projection the two exports run, with the meter
   * swapped and the destination changed: `progressionTrack` marks the track
   * with the revision it was built from, `sendProgression` merges it into the
   * score, and the page then navigates - which is why this lives here and not
   * in a service. `transcription.component.ts` takes the same two steps in the
   * same order for the same reason.
   *
   * ## The meter is the score's, and `sendProgression` throws if it is not
   *
   * A generated track shares the score's master bars, so it has to be barred in
   * the score's meter rather than in the progression's. `ComposerService.scoreMeter`
   * is that meter, and the service verifies it rather than trusting the caller -
   * its refusal names the getter for the same reason this call site uses it:
   * one definition of "the score's meter", in one place, rather than an
   * expression copied out of a docstring that would go on compiling after the
   * definition moved. Re-barring moves no note -
   * `progression-track.ts` argues that under "Why the meter is swapped and not
   * passed" - so this costs the progression nothing but bar lines that agree
   * with everything else in the score.
   *
   * The `GeneratedTrack` is built here, used once and dropped, which
   * `sendProgression` requires: the merged score shares bar objects with it, so
   * a caller that kept one and edited it later would be writing into a
   * committed document behind undo's back.
   *
   * ## Send and Update are one press
   *
   * There is no second method. The merge replaces the track it already wrote
   * and appends only when there is none, so pressing twice is an Update - see
   * `sendLabel`, which says which of the two the next press will be.
   *
   * ## A truncated projection refuses, as the exports do
   *
   * The reasoning is not quite theirs, and it is stronger. An export refuses
   * because a file outlives the message beside it. This message cannot even
   * reach the result: Send navigates, so the rail carrying the warning is gone
   * a moment later, and nothing on the other side would repeat it - a
   * `GeneratedOrigin` records which revision a track was built from, not how
   * much of it arrived, so the Composer cannot draw a badge it has no fact for.
   * The truncated track would then be saved to the library and exported from
   * over there as though it were the whole progression, which is the same lie
   * the export refusal exists to prevent, told one page further from the user.
   *
   * Warning and proceeding was the alternative and it is the worse one for the
   * same reason: a warning nobody is left looking at is not a warning.
   *
   * The refusal cannot name a number, and says so. `write` argues below that
   * "too long" alone does not tell a user how much to cut, and names a count
   * because `progressionToScore` hands one back; `GeneratedTrack` carries a
   * truncation flag and no count. It names the meter for a sharper reason: the
   * bars are counted in the *score's* meter and the exports count them in the
   * progression's, so a 4/4 progression sent to a 3/4 score is refused here and
   * written happily by both exports a moment later - and a message mentioning
   * neither would be unactionable in exactly that case.
   *
   * ## Nothing to send is refused too
   *
   * `sendProgression` cannot make that refusal: an empty projection has no bars
   * to be in the wrong meter, so `requireScoreMeter` passes it, the merge
   * appends a marked track with no music in it, and the page then navigates
   * away from the thing the user did not mean to make.
   *
   * ## What can throw, and who each failure is for
   *
   * Everything that can throw is inside the try - the projection, and the
   * meter check - because a page that broke on a refused send would take the
   * roll and the transport down with a button press. What the catch must not do
   * is paint the thrown message into the rail: `requireScoreMeter` ends its
   * throw with an instruction to change a service call, which is a sentence for
   * whoever is holding the code and not for whoever is holding the mouse. See
   * `reportFailure`, which keeps both readers.
   */
  send(): void {
    const state = this.latest;
    if (!state) return;

    if (state.doc.slots.length === 0) {
      this.showError(
        'There are no chords in this progression yet, so nothing was sent. Add one from the '
        + 'palette and try again.'
      );
      return;
    }

    try {
      const generated = progressionTrack(
        state.doc,
        state.keyScale ? state.keyScale.intervals : [],
        this.composer.scoreMeter
      );

      if (generated.truncated) {
        this.showError(
          `This progression runs past the ${MAX_PREVIEW_BARS} bars a projection stops at, so `
          + 'nothing was sent. A track ending at bar '
          + `${MAX_PREVIEW_BARS} would not be this progression, and nothing it carried into the `
          + 'composer would say so - a generated track records which revision it came from, not '
          + 'how much of it arrived, which is also why this cannot say how far over you are. '
          + `The bars are counted in the score's meter rather than in this progression's, so a `
          + 'progression short enough to export can still be too long to send. Shorten it and '
          + 'try again.'
        );
        return;
      }

      this.composer.sendProgression(generated);
      this.clearError();
      this.leave();
    } catch (error) {
      this.reportFailure(
        error,
        'Something went wrong sending the progression to the composer, so nothing was sent. '
        + 'The details are in the browser console.'
      );
    }
  }

  /**
   * Follows the track to the Composer, and says so when the page does not move.
   *
   * `Router.navigate` answers twice over and both answers can be no: it
   * resolves `false` when a guard turns the move down or a redirect sends it
   * elsewhere, and it rejects when a guard or a resolver throws. `void` on the
   * promise swallowed both - and by the time either can happen the commit has
   * succeeded and the refusal beside the button has been cleared, so the user
   * was left here beside a button that had quietly renamed itself to *Update in
   * Composer*, with no account of why nothing had moved.
   *
   * The sentence says the send stood, because it did. "Could not send" would be
   * false, and a user who read it would press again - harmless, since the merge
   * replaces rather than duplicates, and still the wrong thing to tell someone.
   * A rejection carries a real error as well as a stuck page, and that half
   * goes where the two catches send theirs rather than into the rail.
   *
   * Both callbacks run after `send` has returned, so nothing it did covers
   * them: `showError` marks for check itself, which is what makes that safe.
   */
  private leave(): void {
    this.router.navigate(['/composer']).then(
      moved => {
        if (!moved) this.showError(SENT_BUT_STILL_HERE);
      },
      error => this.reportFailure(error, SENT_BUT_STILL_HERE)
    );
  }

  /** Writes the progression out as a standard MIDI file. */
  exportMidi(): void {
    this.write((score, settings, fileName) =>
      this.exporter.downloadMidiFile(score, settings, fileName)
    );
  }

  /** Writes the progression out as a Guitar Pro 7 file. */
  exportGuitarPro(): void {
    this.write((score, settings, fileName) =>
      this.exporter.downloadGuitarPro(score, settings, fileName)
    );
  }

  /**
   * The three steps both exports share, and the one refusal.
   *
   * Project the document, map it, hand the score over - the same three the
   * composer's own export buttons run, which is what `toMidi` bought: neither
   * of these needs a rendering alphaTab instance, so neither needs the notation
   * panel below to be open.
   *
   * ## A truncated projection refuses
   *
   * `progressionToScore` caps at `MAX_PREVIEW_BARS` and says so, and the
   * preview acts on that by drawing 512 bars with a line above them saying how
   * many it left out. An export cannot: the message sits beside the music on
   * screen, and a file outlives every message that was ever next to it. A `.gp`
   * that quietly stopped at bar 512 would be a file that lies about being the
   * progression - and it would lie later, on someone else's machine, in
   * software that has never heard of this page.
   *
   * So the count and the cap are both in the message. "Too long" alone does not
   * tell the user how much they have to cut.
   *
   * Reachable only through `setSlotLength(id, 1e9)` - 512 bars is around twenty
   * minutes of 4/4 at 100 BPM - which is exactly the case the bound exists for.
   *
   * ## The scale comes from the published state
   *
   * `progressionToScore` is pure and cannot resolve `key.scaleId` itself, so
   * the caller hands it the intervals; `ProgressionState.keyScale` is the
   * service's own answer and this page already holds the latest. Empty when the
   * id resolves to nothing, which spells every note from the key's preference.
   * The notation panel does the same for the same reason, and the two are
   * separate callers rather than one because a preview and a file are drawn at
   * different moments.
   *
   * ## The file is named the way the Composer names the track
   *
   * Through `progressionLabel`, which is the function `progressionTrack` puts
   * both of a generated track's names through. Handing `doc.name` straight to
   * `toFileName` is why one unnamed document arrived in the Composer as
   * *Progression* and on disk as *Untitled.mid*: two readings of one field, and
   * the user's own two copies of one progression disagreeing about its name.
   *
   * Everything that can throw is inside the try, the projection included:
   * `quantizeBar` throws on a meter its grid cannot express, and a page that
   * broke on a bad document would take the roll and the transport down with a
   * download. The thrown message stays out of the rail, for the reason `send`
   * gives: see `reportFailure`.
   */
  private write(
    deliver: (
      score: alphaTab.model.Score,
      settings: alphaTab.Settings,
      fileName: string
    ) => void
  ): void {
    const state = this.latest;
    if (!state) return;

    try {
      const projected = progressionToScore(
        state.doc,
        PROGRESSION_FINEST_DIVISION,
        state.keyScale ? state.keyScale.intervals : []
      );

      if (projected.truncated) {
        this.showError(
          `This progression is ${projected.barCount} bars long and an export stops at `
          + `${MAX_PREVIEW_BARS}. Nothing was written: a file that quietly ended at bar `
          + `${MAX_PREVIEW_BARS} would not be this progression. Shorten it and try again.`
        );
        return;
      }

      const settings = new alphaTab.Settings();
      const score = this.mapper.toScore(projected.doc, settings);
      deliver(score, settings, this.exporter.toFileName(progressionLabel(state.doc.name)));
      this.clearError();
    } catch (error) {
      this.reportFailure(
        error,
        'Something went wrong writing the file, so nothing was downloaded. The details are in '
        + 'the browser console.'
      );
    }
  }

  /**
   * Puts a sentence in front of the user, and makes a repeat of it audible.
   *
   * The swap is the whole of it. Two `role="alert"` regions stand in the rail
   * at all times and the message goes into whichever is empty, so a second
   * refusal identical to the first is still a change *in a live region* - which
   * is the thing assistive technology announces.
   *
   * It marks for check itself rather than leaving that to its callers, two of
   * which are promise callbacks running after the method that started them
   * returned. One rule with no exception in it is cheaper to keep.
   */
  private showError(message: string): void {
    this.exportError = message;
    this.alerts = this.alerts[0] === '' ? [message, ''] : ['', message];
    this.changes.markForCheck();
  }

  /**
   * Takes a message down once the document it was written about has moved.
   *
   * Every sentence this block shows is about what happened to *a document*
   * when a button was pressed - there are no chords in it, it is longer than
   * the projection will draw, it went to the composer. Edit the document and
   * the sentence stops describing anything the user is looking at. The one
   * that made this worth fixing was the empty-progression refusal, which sat
   * in the rail telling a user there were no chords while three of theirs were
   * on screen underneath it.
   *
   * **Keyed on the revision, not on the emission.** This page hears from the
   * progression on every publish, including ones that change no document - a
   * card being selected, a relabel notice clearing - and it hears from the
   * Composer as well, to keep the Send label honest. None of those makes a
   * sentence about this document untrue, and a refusal the user has not
   * answered yet should still be there when they look back at it.
   * `ProgressionDoc.revision` is exactly "the document moved", which is
   * exactly the question being asked. See "Staleness is one comparison" in the
   * design doc for why that counter over-reports, and why over-reporting is
   * the safe direction here too: the cost is a message cleared a moment early,
   * against a message that lies.
   *
   * This is a bug no spec on the press could have caught. The refusal is true
   * when it is written and only rots afterwards, so it was found by running
   * the page.
   */
  private forgetStaleMessage(state: ProgressionState): void {
    const revision = state.doc.revision;
    const moved = this.messageRevision !== null && revision !== this.messageRevision;
    this.messageRevision = revision;

    if (moved && this.exportError !== null) this.clearError();
  }

  /** Takes the last message down, on the attempt that did not need one. */
  private clearError(): void {
    this.exportError = null;
    this.alerts = ['', ''];
    this.changes.markForCheck();
  }

  /**
   * A sentence for the user and the error itself for whoever has to fix it.
   *
   * Two readers and two texts, which is the whole point. `messageOf(error)` in
   * the rail put developer prose on screen in soft pink - `requireScoreMeter`
   * ends its throw with "Build it with ComposerService.scoreMeter." - so a
   * broken contract showed a user an instruction to edit a service call, and a
   * deliberately loud programming error became a paragraph that ships.
   *
   * So the user gets a sentence about their button and the error goes to
   * Angular's `ErrorHandler`, which is where an unhandled one would have gone
   * had the try not been here: the try exists to keep a refused send from
   * taking the roll and the transport down, not to make failures disappear.
   * `errorOf` rather than `new Error(messageOf(error))` keeps the stack that
   * points at where it was actually thrown.
   */
  private reportFailure(error: unknown, sentence: string): void {
    this.showError(sentence);
    this.errors.handleError(errorOf(error));
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
    this.musicTheory.selectKeyAndMode(
      chord.key,
      chord.categoryId,
      chord.itemId,
      chord.rootSpelling
    );
  }

  /**
   * The selection that shows a slot's chord, or null when there is none to
   * show.
   *
   * Three ways there is none, and the last two are the same refusal the strip
   * makes when it prints no numeral on a card - one screen, one answer about
   * what this key can name:
   *
   *  - the id names no slot, which a cue from a schedule built before an edit
   *    can do;
   *  - the slot is `literal`, so it has notes and no degree. Unreachable in M1
   *    until M3's recogniser, and `replaceDocument` is the door it comes
   *    through;
   *  - the key can build no chords, so the stored quality is a leftover from
   *    whichever scale was selected when the slot was made.
   *
   * A fourth was listed here and never existed: "the quality is `'other'`".
   * There is no such check, and the closing paragraph below says what actually
   * happens to a stack with no name - the identity comes back with the notes it
   * builds and the table lights them, while the card prints `?`. Refusing on
   * `'other'` would be the *worse* behaviour, and the reason is two paragraphs
   * down: the notes are known even where the name is not.
   *
   * **It is lit by the interval set, not by the name.** Until M3 Task 5 the
   * quality was handed straight to `findChordCategory` and used as the item id,
   * on the coincidence that twelve `ChordQuality` names were also chord ids -
   * and that coincidence could not survive a composed name, because `V7♭9` is a
   * name no single quality holds. `findChordByIntervals` matches
   * `ChordIdentity.intervals` against the table instead, which makes it a lookup
   * rather than a correspondence: every entry the table holds can light, and a
   * set it does not hold lights nothing.
   *
   * That is strictly more than before. A ninth used to be named after its
   * seventh and lit the seventh - a subset of what was sounding - where the
   * table's own `dominant9` row now matches exactly. The suspended sevenths,
   * the sharp elevenths and the 6/9 are new rows added for the same reason.
   *
   * The identity comes from `effectiveChord`, which is the function the strip
   * card asks too, so the fretboard lights the chord the card beside it names
   * rather than reaching its own conclusion about the same slot. The two can
   * still differ in *detail* - a `7♭5` stack has no `ChordQuality` and prints
   * `?` on the card while the table's `7b5` row lights behind it - and that is
   * the right way round: the notes are known even where the name is not, and
   * showing them is not a claim about what the chord is called.
   */
  private chordFor(slotId: string): AppSelection | null {
    const state = this.latest;
    if (!state) return null;

    const slot = state.doc.slots.find(candidate => candidate.id === slotId);
    if (!slot || slot.harmony.kind !== 'degree') return null;
    if (!state.canBuildChords || !state.keyScale) return null;

    const degree = slot.harmony.degree;
    // `null` means "as the key gives it", and the fretboard wants the chord
    // rather than the override - the same resolution the strip's card makes,
    // through the same function so the two cannot disagree.
    const chord = effectiveChord(state.keyScale.intervals, degree);
    const found = findChordByIntervals(chord.intervals);
    if (!found) return null;

    const key = state.doc.key;
    return {
      // Spelled from the progression's own preference, as the palette and the
      // strip spell it, so the fretboard names the chord the way the card that
      // put it there does.
      key: this.musicTheory.spellNote(
        chordRootPitchClass(key, state.keyScale.intervals, degree),
        key.preferSharps
      ),
      categoryId: found.categoryId,
      itemId: found.itemId,
      // And spelled a second time by the letter the numeral names, because the
      // twelve names above hold no `C♭` and B flat major's `♭II` is one. The
      // fretboard spells the whole chord off this letter - a third two above
      // it, a seventh six - so handing over `B` there would have named every
      // tone of that chord on the wrong letter, under a numeral saying lowered
      // second. This is the same call the strip card and the palette make.
      rootSpelling: chordRootName(key, state.keyScale.intervals, degree)
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

    // The other half of the label's inputs: the marker is matched on the
    // progression's id, so a document replaced here can stop matching a track
    // the Composer still holds.
    this.refreshSendLabel();
  }

  /** Send or Update, from what the Composer currently holds of this document. */
  private refreshSendLabel(): void {
    const state = this.latest;
    const held = state ? generatedTrackState(this.composer.doc, state.doc) : 'absent';

    this.sendLabel = held === 'absent' ? 'Send to Composer' : 'Update in Composer';
  }
}

/**
 * What a send that committed but did not navigate has to say.
 *
 * Not a failure, and worded so it cannot be read as one: the track is in the
 * score by the time this can be shown, so the only thing that did not happen is
 * the move. It names the way back, because the button beside it now says
 * *Update in Composer* and pressing that again would not move the page either.
 */
const SENT_BUT_STILL_HERE =
  'The progression is in the composer, but this page could not move there. Nothing was lost - '
  + 'open the Composer from the navigation at the top of the page to see the track.';

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
