import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  inject
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Subject, interval } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import type { SongSummary } from '../../../models/song.model';
import { messageOf } from '../../../services/error-message';
import { MusicTheoryService } from '../../../services/music-theory.service';
import { ProgressionKeyContext } from '../../../services/progression-key-context';
import { relativeTimeOf } from '../../../services/relative-time';
import { keyNameOf } from '../../../services/song-chord-names';
import { UNTITLED_SONG } from '../../../services/song-document';
import { SongLibraryService } from '../../../services/song-library.service';

/**
 * One song's card, everything it prints worked out once per render rather than in the template: a library re-renders
 * each minute (`relativeTimeOf` moves on), and a card's key name needs a scale lookup.
 */
export interface SongCard {
  id: string;
  /** The song's title, or "Untitled song" when it has none: also the name Delete's question uses. */
  title: string;
  artist: string;
  /** `keyNameOf`: "C Ionian (Major)". Null on a card for a song that cannot be read. */
  keyName: string | null;
  /** "1 section", "4 sections". */
  sections: string;
  /** "5 minutes ago", or null for a record with no usable time (a corrupt one, sorted last as time 0). */
  edited: string | null;
  /** The same moment for `<time datetime>` and, in the reader's own locale, for its tooltip. */
  editedAt: string | null;
  editedOn: string | null;
  /** "This song cannot be opened: <reason>", or null for a song that can be. */
  unreadable: string | null;
  /** The title and artist folded for search (`foldedOf`), so a keystroke compares strings and nothing else. */
  searchText: string;
}

/** How far the first read of the library has got: the empty state waits for `read`, so it never flashes up first. */
type Listing = 'reading' | 'read' | 'failed';

/**
 * The Songs library, at `/songs` (design Part 6): a card for every song, newest first, with search, New song, and on
 * each card Duplicate and Delete.
 *
 * - **A card is a real link** to `/songs/<id>`, stretched over the card by the title's `::after`, so the whole card
 *   opens the song while the link's name is just the title - not the title, artist, key, count and date read out as one
 *   name. The menu button sits above the stretched area, outside the link: a button inside a link is invalid HTML and
 *   a click on it would follow the link.
 * - **A song that cannot be read** gets a card that says why, with Delete as its only action - no link, since opening
 *   it can only say again that it cannot be opened, and no Duplicate, since a copy of it would be a second one
 *   (`SongLibraryService.duplicateSong` refuses it anyway).
 * - **Delete asks first**, through `window.confirm`, naming the song, as the composer's library and the GP library
 *   ask: a song is a writer's work, there is no undo for a delete, and a dialog of the app's own would be the first.
 * - **What the page did, or why it could not**, goes to one polite live region that is always on the page (`say`).
 *
 * The list is the library service's (`getSummaries`); this page holds only what it shows of it - the search, which
 * menu is open, its last message - which is view state, not application state.
 */
@Component({
  selector: 'app-song-library-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './song-library-page.component.html',
  styleUrls: ['./song-library-page.component.scss']
})
export class SongLibraryPageComponent implements OnInit, OnDestroy {
  private readonly library = inject(SongLibraryService);
  private readonly router = inject(Router);
  private readonly changes = inject(ChangeDetectorRef);
  private readonly keys = new ProgressionKeyContext(inject(MusicTheoryService));
  private readonly destroy$ = new Subject<void>();

  @ViewChild('heading', { static: true }) private heading?: ElementRef<HTMLElement>;

  private summaries: readonly SongSummary[] = [];
  private cards: SongCard[] = [];

  /** The cards the search lets through, in the library's order. */
  visibleCards: SongCard[] = [];
  /** The search as typed; matched trimmed and folded (`foldedOf`). */
  query = '';
  listing: Listing = 'reading';
  /** The id of the card whose menu is open; one at a time, as menus are. */
  openMenuId: string | null = null;

  /**
   * The live region's two halves, one holding the message and the other empty, swapped on every message (`say`): the
   * same failure twice is then a change in both, and announced again, where one region set to the text it already
   * holds says nothing - `ProgressionComponent.alerts`' pattern.
   */
  messages: readonly [string, string] = ['', ''];
  /** Whether the message showing is a failure, for its colour; the words say it either way. */
  messageIsError = false;

  /** A New song under way: a second press would make a second song. */
  private creating = false;

  ngOnInit(): void {
    this.library
      .getSummaries()
      .pipe(takeUntil(this.destroy$))
      .subscribe(summaries => {
        this.summaries = summaries;
        // A list published after a failed first read came from a read that worked - a write's - so the library can
        // now be said to be empty if it is.
        if (this.listing === 'failed') this.listing = 'read';
        this.render();
      });

    // "Edited 5 minutes ago" goes stale on a page left open, so the cards are worded again each minute.
    interval(60_000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.render());

    // Read on arrival, because the list nobody watched is stale: another tab may have written since
    // (`SongLibraryService.getSummaries`).
    this.library.refresh().then(
      () => this.settleListing('read'),
      error => {
        this.settleListing('failed');
        this.say(messageOf(error), true);
      }
    );
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  trackById(_index: number, card: SongCard): string {
    return card.id;
  }

  setQuery(query: string): void {
    this.query = query;
    this.filter();
  }

  /** Makes a song and opens it. Its card is there when the user comes back. */
  async createSong(): Promise<void> {
    if (this.creating) return;
    this.creating = true;
    try {
      const song = await this.library.createSong();
      await this.router.navigate(['/songs', song.id]);
    } catch (error) {
      this.say(messageOf(error), true);
    } finally {
      this.creating = false;
    }
  }

  toggleMenu(id: string): void {
    this.openMenuId = this.openMenuId === id ? null : id;
  }

  /** Escape closes the open menu and gives the focus back to its button, since the item focused is hidden with it. */
  closeMenu(toggle: HTMLElement, event: Event): void {
    if (this.openMenuId === null) return;
    event.preventDefault();
    this.openMenuId = null;
    toggle.focus();
  }

  /**
   * A click anywhere outside the cards' menus closes the open one, as a menu is expected to.
   *
   * Any card's menu, not only the open one: this runs in the same dispatch as the toggle's own click, before the view
   * has caught up with it, so the menu just opened is not yet marked open - asking for `.open` here would close every
   * menu the moment it opened. A click on another card's button is that button's to answer (`toggleMenu`).
   */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.openMenuId === null) return;
    const target = event.target;
    if (target instanceof Element && target.closest('.card-menu') !== null) return;
    this.openMenuId = null;
    this.changes.markForCheck();
  }

  /** Copies the song; the copy's card arrives with the list the copy's write publishes. */
  async duplicateSong(card: SongCard, toggle: HTMLElement): Promise<void> {
    this.openMenuId = null;
    toggle.focus();
    try {
      await this.library.duplicateSong(card.id);
      this.say(`Duplicated "${card.title}"`);
    } catch (error) {
      this.say(messageOf(error), true);
    }
  }

  /**
   * Deletes the song once the user has said yes. The card goes, and its button with it, so the focus goes to the page's
   * heading rather than being dropped on the page's body; on a no it goes back to where it was.
   */
  async deleteSong(card: SongCard, returnTo: HTMLElement): Promise<void> {
    this.openMenuId = null;
    returnTo.focus();
    if (!window.confirm(`Delete "${card.title}"? This cannot be undone.`)) return;

    try {
      await this.library.deleteSong(card.id);
      this.say(`Deleted "${card.title}"`);
      this.heading?.nativeElement.focus();
    } catch (error) {
      this.say(messageOf(error), true);
    }
  }

  /** Puts `message` in the live region, in the half that is empty (see `messages`). */
  private say(message: string, isError = false): void {
    this.messages = this.messages[0] === '' ? [message, ''] : ['', message];
    this.messageIsError = isError;
    this.changes.markForCheck();
  }

  private settleListing(listing: Listing): void {
    this.listing = listing;
    this.changes.markForCheck();
  }

  /** Words every card again from the last list, at the current time, and filters them. */
  private render(): void {
    const now = Date.now();
    this.cards = this.summaries.map(summary => this.cardOf(summary, now));
    this.filter();
  }

  private filter(): void {
    const query = foldedOf(this.query.trim());
    this.visibleCards = query === '' ? this.cards : this.cards.filter(card => card.searchText.includes(query));
    this.changes.markForCheck();
  }

  private cardOf(summary: SongSummary, now: number): SongCard {
    const title = summary.title.trim() === '' ? UNTITLED_SONG : summary.title;
    const at = summary.updatedAt > 0 ? new Date(summary.updatedAt) : null;
    return {
      id: summary.id,
      title,
      artist: summary.artist,
      keyName: summary.key === null ? null : keyNameOf(summary.key, this.keys.findScale(summary.key.scaleId)),
      sections: `${summary.sectionCount} section${summary.sectionCount === 1 ? '' : 's'}`,
      edited: at === null ? null : relativeTimeOf(summary.updatedAt, now),
      editedAt: at?.toISOString() ?? null,
      editedOn: at?.toLocaleString() ?? null,
      unreadable: summary.unreadable === null ? null : `This song cannot be opened: ${summary.unreadable}`,
      // The title as shown, so "untitled" finds the songs the page calls that.
      searchText: foldedOf(`${title}\n${summary.artist}`)
    };
  }
}

/**
 * `text` as search compares it: lower case, with accents taken off, so "cafe" finds "Café" and "ANGSTROM" finds
 * "Ångström". NFD splits a letter from its marks and the marks are dropped; a letter with no decomposition (ø, ß)
 * stays as it is, which is the cheap end of accent-insensitive and enough for titles.
 */
function foldedOf(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('en');
}
