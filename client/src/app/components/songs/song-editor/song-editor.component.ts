import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  InjectionToken,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
  inject
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Node } from 'prosemirror-model';
import { Subject, from } from 'rxjs';
import { distinctUntilChanged, map, switchMap, takeUntil, tap } from 'rxjs/operators';
import type { ChordDegree, ProgressionKey } from '../../../models/progression.model';
import type { SongDoc } from '../../../models/song.model';
import { messageOf } from '../../../services/error-message';
import { MusicTheoryService } from '../../../services/music-theory.service';
import { ProgressionKeyContext } from '../../../services/progression-key-context';
import { relativeTimeOf } from '../../../services/relative-time';
import { AutosaveClock, BROWSER_CLOCK, SaveStatus, SongAutosave } from '../../../services/song-autosave';
import { SongEdit, chordWithId, setArtist, setTitle } from '../../../services/song-commands';
import { chordSlotOf, songMetaOf } from '../../../services/song-document';
import { CaretCoords, ChordFieldRequest } from '../../../services/song-editor-plugins';
import { SongLibraryService } from '../../../services/song-library.service';
import { SongSheetPreferencesService } from '../../../services/song-sheet-preferences.service';
import { SongChordFieldComponent } from '../song-chord-field/song-chord-field.component';
import { SongChordPopoverComponent } from '../song-chord-popover/song-chord-popover.component';
import { ChordOpening, SheetHistory, SongSheetComponent } from '../song-sheet/song-sheet.component';
import { SongToolbarComponent } from '../song-toolbar/song-toolbar.component';

/**
 * The clock autosave and the "Saved · 5 minutes ago" wording run on. The browser's own unless a spec hands in one it
 * moves by hand: the page makes its `SongAutosave` itself, so this is the one seam through which its timing reaches
 * a spec.
 */
export const SONG_AUTOSAVE_CLOCK = new InjectionToken<AutosaveClock>('SONG_AUTOSAVE_CLOCK', {
  providedIn: 'root',
  factory: () => BROWSER_CLOCK
});

/** How often "Saved · 5 minutes ago" is worded again while the page is open. */
const REWORD_MS = 60_000;

/** What the page is showing. */
type Phase = 'loading' | 'ready' | 'missing' | 'unreadable';

/** Where a popup over the sheet sits, in the sheet pane's own box (which scrolls with the lyrics). */
interface PaneAnchor {
  left: number;
  top: number;
}

/** The chord field `[` opened: where the chord will go, and where the field sits. */
interface ChordFieldState extends PaneAnchor {
  pos: number;
}

/** The chord popover open: whose, and where it sits. */
interface ChordPopoverState extends PaneAnchor {
  id: string;
}

/** The gap between what a popup hangs under and its top edge, in CSS pixels. */
const POPUP_GAP_PX = 4;

/** What opening the route's song came to. */
type Opened =
  | { kind: 'song'; record: SongDoc; node: Node }
  | { kind: 'missing' }
  | { kind: 'unreadable'; reason: string };

/**
 * A song's page, `/songs/:id` (design Part 2): the header - back to the library, the title and artist, the save
 * status - the song's toolbar, and the sheet.
 *
 * **The song lives in the sheet.** Its document is the sheet's ProseMirror state; this page keeps the latest copy the
 * sheet published (`doc`) only to show it - the title fields, the toolbar - and to hand it to autosave. Every change
 * goes to the sheet as a command (`run`), so the title, the key and the tempo are in the same undo history as the
 * words.
 *
 * **Autosave**, as `SongAutosave`'s comment asks of its page: one per loaded song, persisting through
 * `SongLibraryService.saveSong` and carrying each saved record into the next save, so the revision compare-and-swap
 * sees its own last write; `change` on every new document; `flush` when the tab is hidden or the page is being
 * unloaded; `hasUnsavedChanges` to ask before a tab with unsaved work is closed; `destroy` - which saves what is
 * pending - when the page goes or another song is opened in it.
 *
 * **One polite live region** (`messages`) says everything the page has to say that is not on screen already: a
 * refused command and why, a section deleted and how to get it back, a tempo held to its range, a save that failed -
 * as the library page and the progression page do, two halves that swap so a repeat is still announced. The save
 * status line itself is not live: it changes on every pause in typing, and announcing "Saving…" each time would bury
 * everything else. A failure is the exception, and goes to the region too.
 *
 * **The chord field and the chord popover** are the page's, over the sheet (design Part 2): `[` in the lyrics opens the
 * field at the caret, and its chord is placed where `[` was pressed (`SongSheetComponent.placeChord`); a click on a
 * chord's name, or Enter on a selected chord, opens the popover under the name, whose edits run on the sheet like the
 * toolbar's. One is open at a time. Both sit in the sheet's scrolling pane, anchored in its box, so they scroll with
 * the words they belong to. **Focus:** the field and the popover take it when they open; Escape - and placing a chord,
 * and deleting one - give it back to the lyrics, at the caret or with the chord still selected; a press elsewhere
 * closes either and leaves the focus where the press put it. A field left for nowhere (the focus dropped to the page
 * itself) gives it back to the lyrics too, so typing goes on where it was.
 *
 * The page is laid out as a one-column grid under the toolbar so the Chords panel (task 8) slots in as a second
 * column without moving the sheet.
 */
@Component({
  selector: 'app-song-editor',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    SongChordFieldComponent,
    SongChordPopoverComponent,
    SongSheetComponent,
    SongToolbarComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './song-editor.component.html',
  styleUrls: ['./song-editor.component.scss']
})
export class SongEditorComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly library = inject(SongLibraryService);
  private readonly preferencesService = inject(SongSheetPreferencesService);
  private readonly changes = inject(ChangeDetectorRef);
  private readonly zone = inject(NgZone);
  private readonly clock = inject(SONG_AUTOSAVE_CLOCK);
  private readonly destroy$ = new Subject<void>();
  /** Ends the subscriptions of the song open now, when another is opened in its place or the page goes. */
  private readonly songClosed$ = new Subject<void>();

  /** The app's key rules, handed to the toolbar for its commands and to the sheet for its chord names. */
  readonly keys = new ProgressionKeyContext(inject(MusicTheoryService));

  @ViewChild(SongSheetComponent) private sheet?: SongSheetComponent;
  @ViewChild('titleField') private titleField?: ElementRef<HTMLInputElement>;
  @ViewChild('artistField') private artistField?: ElementRef<HTMLInputElement>;
  @ViewChild('sheetPane') private sheetPane?: ElementRef<HTMLElement>;

  phase: Phase = 'loading';
  /** Why the song cannot be opened, in the `unreadable` phase. */
  reason = '';
  /** The document the sheet starts from; set once per song opened. */
  initialDoc: Node | null = null;
  /** The latest document the sheet has published. */
  doc: Node | null = null;
  title = '';
  artist = '';
  status: SaveStatus | null = null;
  /** The save status in words: "Saved · just now", "Saving…", "Unsaved changes", "Not saved: <reason>". */
  statusText = '';
  history: SheetHistory = { canUndo: false, canRedo: false };
  preferences = this.preferencesService.preferences;

  /** The song's key, and its scale when it can build chords: what the chord field reads a chord in. */
  key: ProgressionKey | null = null;
  scaleIntervals: readonly number[] | null = null;
  /** The chord field, while `[` has it open. */
  chordField: ChordFieldState | null = null;
  /** The chord popover, while one is open. */
  chordPopover: ChordPopoverState | null = null;

  /** The live region's two halves (see the class comment). */
  messages: readonly [string, string] = ['', ''];
  messageIsError = false;

  private autosave: SongAutosave<Node> | null = null;
  private rewordTimer: unknown = null;

  ngOnInit(): void {
    this.preferencesService.preferences$.pipe(takeUntil(this.destroy$)).subscribe(preferences => {
      this.preferences = preferences;
      this.changes.markForCheck();
    });

    // Another song opened in this page - a link from one song to another - reuses the page, so each id the route
    // gives is a close of the song before it and an open of the new one; a song still loading when the next id
    // arrives is dropped (`switchMap`).
    this.route.paramMap
      .pipe(
        map(params => params.get('id') ?? ''),
        distinctUntilChanged(),
        tap(() => this.closeSong()),
        switchMap(id => from(this.openedOf(id))),
        takeUntil(this.destroy$)
      )
      .subscribe(opened => this.zone.run(() => this.show(opened)));

    this.scheduleReword();
  }

  ngOnDestroy(): void {
    this.closeSong();
    this.clock.clearTimeout(this.rewordTimer);
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ---------------------------------------------------------------------------
  // The page's events
  // ---------------------------------------------------------------------------

  /** Hidden - another tab, the window minimised, the phone locked - is often the last the page hears: save now. */
  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') this.saveNow();
  }

  /** Best effort: the browser may stop the page before an IndexedDB write commits, which is why hidden saves first. */
  @HostListener('window:pagehide')
  onPageHide(): void {
    this.saveNow();
  }

  /**
   * Asks before the tab closes or reloads while a change is not yet saved, and starts saving it. With nothing pending
   * the tab closes without a word.
   */
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    this.commitFields();
    if (!this.autosave?.hasUnsavedChanges()) return;
    void this.autosave.flush();
    event.preventDefault();
    // Older browsers ask only when `returnValue` is set; its text is never shown.
    event.returnValue = '';
  }

  // ---------------------------------------------------------------------------
  // What the template calls
  // ---------------------------------------------------------------------------

  /** Runs a command on the sheet: the toolbar's, and the header's title and artist. */
  run(edit: SongEdit): void {
    this.sheet?.run(edit);
  }

  onDocChanged(doc: Node): void {
    this.adopt(doc);
    this.autosave?.change(doc);
    // A popover whose chord has gone - undone away, deleted - has nothing left to show.
    if (this.chordPopover !== null && chordWithId(doc, this.chordPopover.id) === null) this.chordPopover = null;
  }

  onHistoryChanged(history: SheetHistory): void {
    this.history = history;
  }

  undo(): void {
    this.sheet?.undo();
  }

  redo(): void {
    this.sheet?.redo();
  }

  focusSheet(): void {
    this.sheet?.focus();
  }

  /**
   * The title committed - Enter, or leaving the field - as one command, so one undo step: the field is not a command
   * per keystroke, which would make every letter of a title an undo step of its own.
   */
  commitTitle(value: string): void {
    if (value !== this.title) this.run(setTitle(value));
  }

  commitArtist(value: string): void {
    if (value !== this.artist) this.run(setArtist(value));
  }

  /** Escape in the title or artist field puts back what the song says and leaves the field. */
  revertField(field: HTMLInputElement, value: string): void {
    field.value = value;
    field.blur();
  }

  // ---------------------------------------------------------------------------
  // The chord field and the chord popover
  // ---------------------------------------------------------------------------

  // Every opening and closing below is rendered at once (`detectChanges`) rather than on the next frame, which is when
  // this zoneless app would otherwise render a `markForCheck`. Typing outruns frames. A field opened by `[` must hold
  // the focus before the next key arrives, or `[Am]` typed in one go - the ChordPro way - puts its `Am` into the
  // lyrics; and a field closed by Enter must be gone before the next `[`, or that `[` finds the old field still on the
  // page, and `*ngIf` keeps it - with its old text, and without taking the focus again.

  /** `[` in the lyrics: the field opens under the caret, remembering where the chord goes. */
  openChordField(request: ChordFieldRequest): void {
    this.chordPopover = null;
    this.chordField = { pos: request.pos, ...this.anchorFor(request.coords) };
    this.changes.detectChanges();
  }

  /**
   * The field read a chord: it goes where `[` was pressed, voiced and a bar long, and the focus goes back after it. A
   * refusal - which would take the song changing under an open field - is said in the live region by the sheet.
   */
  placeChord(degree: ChordDegree): void {
    const field = this.chordField;
    const doc = this.doc;
    if (field === null || doc === null) return;
    const { key, timeSignature } = songMetaOf(doc);
    this.chordField = null;
    this.sheet?.placeChord(field.pos, chordSlotOf(degree, key, this.keys.chordScaleFor(key), timeSignature));
    this.changes.detectChanges();
  }

  /** Escape in the field: nothing placed, and the focus back in the lyrics at the caret. */
  cancelChordField(): void {
    this.chordField = null;
    this.focusSheet();
    this.changes.detectChanges();
  }

  /**
   * The focus left the field for somewhere outside it: it closes, placing nothing, and the focus stays where it went -
   * unless it went nowhere, when it comes back to the lyrics.
   */
  onChordFieldFocusOut(event: FocusEvent, anchor: HTMLElement): void {
    const next = event.relatedTarget;
    if (next instanceof globalThis.Node && anchor.contains(next)) return;
    if (this.chordField === null) return;
    this.chordField = null;
    if (next === null) this.focusSheet();
    this.changes.detectChanges();
  }

  /** A chord's name clicked, or Enter on it: its popover, under the name. */
  openChordPopover(opening: ChordOpening): void {
    this.chordField = null;
    this.chordPopover = { id: opening.id, ...this.anchorFor(opening.anchor) };
    this.changes.detectChanges();
  }

  /** The popover is done; `giveFocusBack` when it closed by its own keys or buttons rather than a press elsewhere. */
  closeChordPopover(giveFocusBack: boolean): void {
    this.chordPopover = null;
    if (giveFocusBack) this.focusSheet();
    this.changes.detectChanges();
  }

  /** Retry, after a failed save: saves now, with the change that failed or anything newer. */
  retry(): void {
    void this.autosave?.flush();
  }

  /** Puts `message` in the live region, in the half that is empty (see `messages`). */
  say(message: string, isError = false): void {
    this.messages = this.messages[0] === '' ? [message, ''] : ['', message];
    this.messageIsError = isError;
    this.changes.markForCheck();
  }

  // ---------------------------------------------------------------------------
  // Opening and closing a song
  // ---------------------------------------------------------------------------

  /** The song `id` read from the library, as what the page will show. Never rejects: a failed read is a reason. */
  private async openedOf(id: string): Promise<Opened> {
    try {
      const loaded = await this.library.loadSong(id);
      if (loaded === null) return { kind: 'missing' };
      if (loaded.kind === 'unreadable') return { kind: 'unreadable', reason: loaded.reason };
      return { kind: 'song', record: loaded.doc, node: loaded.node };
    } catch (error) {
      return { kind: 'unreadable', reason: messageOf(error) };
    }
  }

  private show(opened: Opened): void {
    if (opened.kind === 'missing') {
      this.phase = 'missing';
    } else if (opened.kind === 'unreadable') {
      this.phase = 'unreadable';
      this.reason = opened.reason;
    } else {
      this.startAutosave(opened.record);
      this.initialDoc = opened.node;
      this.adopt(opened.node);
      this.phase = 'ready';
    }
    this.changes.markForCheck();
  }

  /**
   * Makes the song's autosave. Its `persist` keeps the record each save returns and sends the next save from it: the
   * library refuses a save whose revision is not the stored one, and only the record it last wrote has that revision.
   * `SongAutosave` never runs two persists at once, so the record is never read while a save is still writing it.
   */
  private startAutosave(saved: SongDoc): void {
    let record = saved;
    const autosave = new SongAutosave<Node>({
      persist: async doc => {
        record = await this.library.saveSong({ ...record, content: doc.toJSON() });
      },
      savedAt: record.updatedAt,
      clock: this.clock
    });
    this.autosave = autosave;
    autosave.status$
      .pipe(takeUntil(this.songClosed$))
      .subscribe(status => this.zone.run(() => this.onStatus(status)));
  }

  /**
   * Lets the open song go: whatever its fields hold is committed, its pending change saved (`destroy`, which goes on
   * after the page has gone, and lands), and the page emptied for the next.
   */
  private closeSong(): void {
    this.commitFields();
    this.songClosed$.next();
    const autosave = this.autosave;
    this.autosave = null;
    void autosave?.destroy();

    this.phase = 'loading';
    this.initialDoc = null;
    this.doc = null;
    this.key = null;
    this.scaleIntervals = null;
    this.chordField = null;
    this.chordPopover = null;
    this.status = null;
    this.statusText = '';
    this.history = { canUndo: false, canRedo: false };
  }

  private adopt(doc: Node): void {
    this.doc = doc;
    const meta = songMetaOf(doc);
    this.title = meta.title;
    this.artist = meta.artist;
    if (meta.key !== this.key) {
      this.key = meta.key;
      this.scaleIntervals = this.keys.chordScaleFor(meta.key);
    }
    this.changes.markForCheck();
  }

  /**
   * A popup's place under `coords` - a box on screen - in the sheet pane's own box, scrolled: the pane is the popup's
   * positioned parent and scrolls it with the lyrics. At the pane's top left when there is nothing to measure.
   */
  private anchorFor(coords: CaretCoords | null): PaneAnchor {
    const pane = this.sheetPane?.nativeElement;
    if (coords === null || pane === undefined) return { left: 0, top: 0 };
    const box = pane.getBoundingClientRect();
    return {
      left: coords.left - box.left + pane.scrollLeft,
      top: coords.bottom - box.top + pane.scrollTop + POPUP_GAP_PX
    };
  }

  // ---------------------------------------------------------------------------
  // Saving
  // ---------------------------------------------------------------------------

  /** Commits what the fields hold and saves everything pending now. */
  private saveNow(): void {
    this.commitFields();
    void this.autosave?.flush();
  }

  /**
   * Commits a title or artist still being typed. A field commits when it is left, and hiding the tab or closing it
   * does not leave it - the focus stays put - so without this the last words typed there would not be saved.
   */
  private commitFields(): void {
    const title = this.titleField?.nativeElement.value;
    const artist = this.artistField?.nativeElement.value;
    if (title !== undefined) this.commitTitle(title);
    if (artist !== undefined) this.commitArtist(artist);
  }

  private onStatus(status: SaveStatus): void {
    this.status = status;
    this.wordStatus();
    if (status.kind === 'failed') this.say(`Not saved: ${status.reason}`, true);
  }

  private wordStatus(): void {
    const status = this.status;
    switch (status?.kind) {
      case 'saved':
        this.statusText = `Saved · ${relativeTimeOf(status.at, this.clock.now())}`;
        break;
      case 'saving':
        this.statusText = 'Saving…';
        break;
      case 'unsaved':
        this.statusText = 'Unsaved changes';
        break;
      case 'failed':
        this.statusText = `Not saved: ${status.reason}`;
        break;
      default:
        this.statusText = '';
    }
    this.changes.markForCheck();
  }

  /**
   * Words the save status again each minute, so "just now" becomes "1 minute ago" on a page left open. On the
   * autosave's clock, so a spec moving time moves this too; outside Angular's zone, so a timer always pending never
   * keeps the zone from settling, and back in it only to re-word.
   */
  private scheduleReword(): void {
    this.zone.runOutsideAngular(() => {
      this.rewordTimer = this.clock.setTimeout(() => {
        this.zone.run(() => this.wordStatus());
        this.scheduleReword();
      }, REWORD_MS);
    });
  }
}
