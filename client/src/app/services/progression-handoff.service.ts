import { DestroyRef, ErrorHandler, Injectable, InjectionToken, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';
import type { ProgressionDoc, ProgressionKey, ProgressionState } from '../models/progression.model';
import { SECTION_KINDS, SectionKind } from '../models/song.model';
import { errorOf } from './error-message';
import { requireUniqueSlotIds, settle } from './progression-edit';
import { ProgressionService } from './progression.service';

/**
 * Where an open link is kept across a reload: the tab's session storage, or null where the browser refuses it (a
 * locked-down private window), when the link lives in memory only. A spec hands in a map of its own, so nothing it
 * opens is left in the browser for the next spec to restore.
 */
export const PROGRESSION_HANDOFF_STORAGE = new InjectionToken<Storage | null>('PROGRESSION_HANDOFF_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  }
});

/** The key the link is stored under, and the shape's version, so a later shape can tell an old record from its own. */
const STORAGE_KEY = 'progression-handoff';
const STORAGE_VERSION = 1;

/**
 * A section on its way out to the Progression page: what `sectionHandoffOf` (`song-progression-return.ts`) makes of
 * a song. Built on the song's side, so this service - which the Progression page loads - never imports ProseMirror.
 */
export interface SectionHandoff {
  songId: string;
  /** As the banner names it: the song's title, or "Untitled song". */
  songTitle: string;
  sectionId: string;
  sectionLabel: string;
  sectionKind: SectionKind;
  /** The section's derived progression (`sectionProgressionOf`): its id is the section's. */
  progression: ProgressionDoc;
}

/** The one section out on the Progression page, and what to put back when it comes home. */
export interface ProgressionLink {
  songId: string;
  songTitle: string;
  sectionId: string;
  sectionLabel: string;
  sectionKind: SectionKind;
  /**
   * The section's progression as the Progression page's store published it on the way out. Its `revision` is the
   * sent revision - the store re-issues revisions on every commit, so the document open there has moved off it
   * exactly when something was edited - and its slots are the base the song's merge compares against.
   */
  sent: ProgressionDoc;
  /** The user's own progression, set aside to make room for the section, and put back when it comes home. */
  previous: ProgressionDoc;
  /** Whether `previous` had unsaved changes when it was set aside, so it is put back as the user had it. */
  previousDirty: boolean;
  /** Whether the circle of fifths names a key other than the song's, which the banner then explains. */
  keyHeld: boolean;
}

/** A section's progression handed back to its song, waiting for the song's page to take it. */
export interface ProgressionReturn {
  songId: string;
  sectionId: string;
  sectionLabel: string;
  sectionKind: SectionKind;
  sent: ProgressionDoc;
  returned: ProgressionDoc;
}

/** What the Progression page's banner shows, while a link's section is the progression open there. */
export interface HandoffBanner {
  sectionLabel: string;
  songTitle: string;
  /** The song's key, which holds while the section is open (see `declineKey`). */
  key: ProgressionKey;
  /** The scale the key names, as the page's state resolved it, for saying the key in words. */
  scaleName: string | null;
  keyHeld: boolean;
}

/** What is kept in session storage. */
interface StoredHandoff {
  version: number;
  link: ProgressionLink | null;
  /** The latest document the link's progression has been on the Progression page: what a reload puts back there. */
  current: ProgressionDoc | null;
  returns: ProgressionReturn[];
}

/**
 * Open in Progression and back (brief decision 7): the one link between a song's section and the Progression page.
 *
 * **Going out** (`open`): the section's derived progression replaces the one on the Progression page, which is kept
 * to put back; the revision the store gives it is recorded; and the app goes there. The song's page saves itself
 * before it calls this, so the song it opens on return is the stored one.
 *
 * **There**, while the section's progression is the one open (`isLinked`, by id: a section's progression carries the
 * section's id), the page shows a banner (`banner$`) and does not take the circle of fifths' key (`declineKey`): the
 * key is the song's, shared by every section, and set on the song.
 *
 * **Coming back** (`returnToSong`): the edited progression is captured, the user's own put back, and the app goes to
 * the song, whose page takes what came back (`takeReturn`) and applies it as one undo step
 * (`songAfterReturnOf`). With nothing edited there, coming back is a cancel (`cancel`): nothing is handed back, so
 * the song's page has nothing to apply and nothing to say.
 *
 * ## Nothing set aside is ever lost
 *
 * - **The user's own progression.** Kept on the link and put back on the way home - marked unsaved if it was unsaved
 *   when it was set aside, clean if it was clean, as the user had it. Opening a second section while one is out
 *   replaces the link but carries its `previous` over: the progression on the page then is the first section's, not
 *   the user's, and setting *that* aside would put the wrong one back.
 * - **A first section's edits, when a second is opened over them.** They are handed back to the first section's song
 *   as if Back to song had been pressed, and wait for its page to take them. Opening the section already out - edited
 *   or not - goes back to it as it is rather than deriving it afresh over the edits.
 * - **A reload.** The Progression page holds its document in memory only, so a reload would lose both the section's
 *   edits and the user's own progression set aside for them - and the latter would be the hand-off's doing. So the
 *   link, the section's latest progression and any return not yet taken are kept in **session storage** and restored
 *   when the app starts again: the Progression page comes back on the section, edits and all, still linked. Session
 *   rather than local storage, because a link belongs to one tab's trip out and back: a second tab restoring the same
 *   link would bring the same edits back twice.
 *
 * Root, as `ProgressionService` is: the link has to outlive both pages it connects.
 */
@Injectable({ providedIn: 'root' })
export class ProgressionHandoffService {
  private readonly progression = inject(ProgressionService);
  private readonly router = inject(Router);
  private readonly errors = inject(ErrorHandler);
  private readonly storage = inject(PROGRESSION_HANDOFF_STORAGE);
  private readonly linkSubject = new BehaviorSubject<ProgressionLink | null>(null);
  /** Returns handed back and not yet taken by their song's page. */
  private returns: ProgressionReturn[] = [];
  /** The latest document the link's progression has been, for a reload to put back (see the class comment). */
  private current: ProgressionDoc | null = null;
  /** Whether the progression open now has unsaved changes: what `previousDirty` records. */
  private dirty = false;

  /**
   * The banner, while the link's section is the progression open on the Progression page; null otherwise - with no
   * link, and also while the user has undone back past the hand-off to their own progression there.
   */
  readonly banner$: Observable<HandoffBanner | null>;

  constructor() {
    this.restore();

    const state$ = this.progression.getState();
    state$.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(state => this.follow(state));
    this.banner$ = combineLatest([this.linkSubject, state$]).pipe(map(([link, state]) => bannerOf(link, state)));
  }

  /** The section out on the Progression page, or null. */
  get link(): ProgressionLink | null {
    return this.linkSubject.getValue();
  }

  /** Whether `doc` is the progression of the section out on the Progression page. */
  isLinked(doc: ProgressionDoc): boolean {
    return this.link?.sent.id === doc.id;
  }

  /**
   * Sends `section` to the Progression page, setting aside the progression there, and goes there. See the class
   * comment for a second open and for opening the section already out.
   */
  open(section: SectionHandoff): void {
    const link = this.link;
    const open = this.progression.doc;
    const linked = link !== null && this.isLinked(open);

    if (linked && link.songId === section.songId && link.sectionId === section.sectionId) {
      void this.go(['/progression']);
      return;
    }
    if (linked && open.revision !== link.sent.revision) this.returns.push(returnOf(link, open));

    const previous = linked ? link.previous : open;
    const previousDirty = linked ? link.previousDirty : this.dirty;
    // Clean: the section's progression is the song's, saved with it, so nothing about it is unsaved yet.
    this.progression.replaceDocument(section.progression, true);
    const sent = this.progression.doc;
    this.current = sent;
    this.linkSubject.next({
      songId: section.songId,
      songTitle: section.songTitle,
      sectionId: section.sectionId,
      sectionLabel: section.sectionLabel,
      sectionKind: section.sectionKind,
      sent,
      previous,
      previousDirty,
      keyHeld: false
    });
    this.save();
    void this.go(['/progression']);
  }

  /**
   * Back to song: hands the section's progression back to its song if anything was edited there, puts the user's own
   * progression back, and goes to the song. False, doing nothing, while the progression open is not the section's.
   */
  returnToSong(): Promise<boolean> {
    return this.close(true);
  }

  /** Goes back to the song without the edits made there, putting the user's own progression back. */
  cancel(): Promise<boolean> {
    return this.close(false);
  }

  /** The returns waiting for the song `songId`, in the order they were handed back; taking them clears them. */
  takeReturn(songId: string): ProgressionReturn[] {
    const taken = this.returns.filter(back => back.songId === songId);
    if (taken.length === 0) return [];
    this.returns = this.returns.filter(back => back.songId !== songId);
    this.save();
    return taken;
  }

  /**
   * The circle of fifths offering `offered` as the key of the progression `open`: declined, answering true, while
   * `open` is a section's progression, whose key is the song's (the caller must then not re-key it). The banner is
   * told whether the circle's key differs from the song's, so it can say why it was not taken. False for any other
   * progression, which takes the circle's key as always.
   */
  declineKey(open: ProgressionDoc, offered: ProgressionKey): boolean {
    const link = this.link;
    if (link === null || !this.isLinked(open)) return false;
    const keyHeld =
      offered.tonic !== open.key.tonic ||
      offered.scaleId !== open.key.scaleId ||
      offered.preferSharps !== open.key.preferSharps;
    if (keyHeld !== link.keyHeld) {
      this.linkSubject.next({ ...link, keyHeld });
      this.save();
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // The way home
  // ---------------------------------------------------------------------------

  /** Ends the link, handing the section's edits back when `keep` and there are any, and goes to its song. */
  private close(keep: boolean): Promise<boolean> {
    const link = this.link;
    const open = this.progression.doc;
    if (link === null || !this.isLinked(open)) return Promise.resolve(false);

    if (keep && open.revision !== link.sent.revision) this.returns.push(returnOf(link, open));
    // The link goes first, so the publish below is not followed as the section's latest.
    this.linkSubject.next(null);
    this.current = null;
    this.progression.replaceDocument(link.previous, !link.previousDirty);
    this.save();
    return this.go(['/songs', link.songId]);
  }

  /** Navigates, reporting a navigation that throws rather than leaving it unhandled. */
  private go(commands: string[]): Promise<boolean> {
    return this.router.navigate(commands).catch((error: unknown) => {
      this.errors.handleError(errorOf(error));
      return false;
    });
  }

  // ---------------------------------------------------------------------------
  // Following the page, and the reload
  // ---------------------------------------------------------------------------

  /** Keeps the section's latest progression for a reload, and whether the page's progression is unsaved. */
  private follow(state: ProgressionState): void {
    this.dirty = state.isDirty;
    if (this.link === null || !this.isLinked(state.doc) || state.doc === this.current) return;
    this.current = state.doc;
    this.save();
  }

  /** Writes the link, the section's latest progression and the waiting returns to storage, or clears it when empty. */
  private save(): void {
    const storage = this.storage;
    if (storage === null) return;
    try {
      if (this.link === null && this.returns.length === 0) {
        storage.removeItem(STORAGE_KEY);
        return;
      }
      const stored: StoredHandoff = {
        version: STORAGE_VERSION,
        link: this.link,
        current: this.current,
        returns: this.returns
      };
      storage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch (error) {
      // A full or refused storage: the link still works in memory, it just would not survive a reload.
      this.errors.handleError(errorOf(error));
    }
  }

  /**
   * Picks up what a reload left in storage: the waiting returns, and the link with its section's latest progression,
   * which goes back on the Progression page as it was.
   *
   * The section's progression is put back only over the store's untouched starting document (revision 0, before any
   * commit). This service is made by the first page that needs it - the Progression page makes it before it can edit
   * anything - so that is always the case after a reload; were it not, the progression there would be the user's own
   * work, which is not to be written over. The section's edits are then handed back to its song instead.
   *
   * A record that cannot be read is reported and dropped: it is this service's own writing, so it is damaged, not
   * the user's, and keeping it would fail the same way on every start.
   */
  private restore(): void {
    const storage = this.storage;
    if (storage === null) return;
    let stored: StoredHandoff | null;
    try {
      stored = storedHandoffOf(storage.getItem(STORAGE_KEY));
    } catch (error) {
      this.errors.handleError(errorOf(error));
      this.removeStored();
      return;
    }
    if (stored === null) return;

    this.returns = stored.returns;
    const link = stored.link;
    if (link !== null) {
      const doc = stored.current ?? link.sent;
      const edited = doc.revision !== link.sent.revision;
      if (this.progression.doc.revision !== 0) {
        if (edited) this.returns.push(returnOf(link, doc));
      } else {
        this.progression.replaceDocument(doc, !edited);
        this.current = this.progression.doc;
        // Re-issued on the way in (`replaceDocument`), so an unedited progression is re-sent at its new revision to
        // keep reading as unedited; an edited one keeps the old sent revision, which it has moved off.
        this.linkSubject.next(edited ? link : { ...link, sent: this.current });
      }
    }
    this.save();
  }

  private removeStored(): void {
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      // Nothing more to do: a storage that refuses a remove has nothing this service can clear.
    }
  }
}

/** The link's section, handed back as `returned`. */
function returnOf(link: ProgressionLink, returned: ProgressionDoc): ProgressionReturn {
  return {
    songId: link.songId,
    sectionId: link.sectionId,
    sectionLabel: link.sectionLabel,
    sectionKind: link.sectionKind,
    sent: link.sent,
    returned
  };
}

function bannerOf(link: ProgressionLink | null, state: ProgressionState): HandoffBanner | null {
  if (link === null || link.sent.id !== state.doc.id) return null;
  return {
    sectionLabel: link.sectionLabel,
    songTitle: link.songTitle,
    key: state.doc.key,
    scaleName: state.keyScale?.name ?? null,
    keyHeld: link.keyHeld
  };
}

// ---------------------------------------------------------------------------
// Reading storage
// ---------------------------------------------------------------------------

/** The stored hand-off in `text`, null when there is none, or a throw naming what is wrong with it. */
function storedHandoffOf(text: string | null): StoredHandoff | null {
  if (text === null) return null;
  const value = record(JSON.parse(text), 'The stored hand-off');
  if (value['version'] !== STORAGE_VERSION) {
    throw new Error(`The stored hand-off is version ${String(value['version'])}.`);
  }
  const returns = value['returns'];
  if (!Array.isArray(returns)) throw new Error('The stored hand-off has no list of returns.');
  return {
    version: STORAGE_VERSION,
    link: value['link'] === null ? null : linkOf(value['link']),
    current: value['current'] === null ? null : progressionOf(value['current']),
    returns: returns.map(returnFrom)
  };
}

function linkOf(value: unknown): ProgressionLink {
  const link = record(value, 'The stored link');
  if (typeof link['previousDirty'] !== 'boolean' || typeof link['keyHeld'] !== 'boolean') {
    throw new Error('The stored link is missing its flags.');
  }
  return {
    ...sectionFieldsOf(link, 'The stored link'),
    songTitle: text(link, 'songTitle', 'The stored link'),
    sent: progressionOf(link['sent']),
    previous: progressionOf(link['previous']),
    previousDirty: link['previousDirty'],
    keyHeld: link['keyHeld']
  };
}

function returnFrom(value: unknown): ProgressionReturn {
  const back = record(value, 'A stored return');
  return {
    ...sectionFieldsOf(back, 'A stored return'),
    sent: progressionOf(back['sent']),
    returned: progressionOf(back['returned'])
  };
}

function sectionFieldsOf(
  value: Record<string, unknown>,
  subject: string
): Pick<ProgressionLink, 'songId' | 'sectionId' | 'sectionLabel' | 'sectionKind'> {
  const kind = value['sectionKind'];
  if (!SECTION_KINDS.includes(kind as SectionKind)) throw new Error(`${subject} has no section kind.`);
  return {
    songId: text(value, 'songId', subject),
    sectionId: text(value, 'sectionId', subject),
    sectionLabel: text(value, 'sectionLabel', subject),
    sectionKind: kind as SectionKind
  };
}

/** A stored progression, through the store's own checks: settled, with unique slot ids. Throws when it fails them. */
function progressionOf(value: unknown): ProgressionDoc {
  const doc = record(value, 'A stored progression') as unknown as ProgressionDoc;
  if (typeof doc.id !== 'string' || typeof doc.revision !== 'number' || !Array.isArray(doc.slots)) {
    throw new Error('A stored progression is not a progression.');
  }
  return settle(requireUniqueSlotIds(doc));
}

function record(value: unknown, subject: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${subject} is not a record.`);
  }
  return value as Record<string, unknown>;
}

function text(value: Record<string, unknown>, name: string, subject: string): string {
  const field = value[name];
  if (typeof field !== 'string') throw new Error(`${subject} has no ${name}.`);
  return field;
}
