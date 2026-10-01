import { Injectable, InjectionToken, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

/** The three lyric sizes the sheet's `Aa` steps through. */
export type LyricSize = 'small' | 'medium' | 'large';

/** Every lyric size, in the order `Aa` steps through them. */
export const LYRIC_SIZES: readonly LyricSize[] = Object.freeze(['small', 'medium', 'large']);

/** How this viewer likes the sheet shown. */
export interface SongSheetPreferences {
  /** Roman numerals over the words (`I-IV` pressed) rather than chord names. */
  numerals: boolean;
  lyricSize: LyricSize;
  /** The song page's side panel - the Chords tab - shown beside the sheet, or folded away to give the lyrics room. */
  panelOpen: boolean;
  /**
   * A chord placed from the Chords tab sounds as it lands ("Play chords as I place them"). On by default, as
   * songcraft plays on click: building a line a click at a time is easier by ear. Off for a viewer in a quiet room,
   * or one who already knows what they are placing; the popover's Hear it plays a chord either way.
   */
  playOnPlace: boolean;
}

const DEFAULTS: SongSheetPreferences = Object.freeze({
  numerals: false,
  lyricSize: 'medium',
  panelOpen: true,
  playOnPlace: true
});

/** One key for every choice, so they are read and written together. */
const STORAGE_KEY = 'songSheetPreferences';

/**
 * Where the preferences are kept: the browser's `localStorage`, or null when the browser will not give it (a sandboxed
 * frame, storage blocked for the site), which reaching for it throws. A token so a spec hands in storage of its own
 * and never leaves a choice behind in the developer's browser.
 */
export const SONG_PREFERENCES_STORAGE = new InjectionToken<Storage | null>('SONG_PREFERENCES_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }
});

/**
 * How the song sheet is shown to this viewer: chord names or Roman numerals (`I-IV`), the lyric size (`Aa`), whether
 * the side panel is open (Hide panel / Show panel), and whether a chord placed from it sounds.
 *
 * **Kept out of the song on purpose.** Each is how one person likes to work with a sheet, not what the song is: a
 * co-writer reading in numerals should not turn the other's sheet into numerals, a size change or a folded panel
 * should not be an undo step, and none should mark the song unsaved or bump its revision. So they live per browser, in `localStorage`,
 * and the document - which design Part 8 keeps for what a future sync would share - never sees them.
 *
 * **A root service rather than storage calls in the page**, so the toolbar that changes them and the page that hands
 * them to the sheet read one source, and the choice holds across every song opened in the visit.
 *
 * **Storage never fails a choice.** Every read and write is guarded: a browser that refuses storage, or is full, keeps
 * the choice for the visit and forgets it on reload, which is the most a preference can lose.
 */
@Injectable({ providedIn: 'root' })
export class SongSheetPreferencesService {
  private readonly storage = inject(SONG_PREFERENCES_STORAGE);
  private readonly subject = new BehaviorSubject<SongSheetPreferences>(this.read());

  /** The preferences now and on every change; a choice that changes nothing is not published. */
  readonly preferences$: Observable<SongSheetPreferences> = this.subject.asObservable();

  get preferences(): SongSheetPreferences {
    return this.subject.getValue();
  }

  setNumerals(numerals: boolean): void {
    this.update({ ...this.preferences, numerals });
  }

  setLyricSize(lyricSize: LyricSize): void {
    this.update({ ...this.preferences, lyricSize });
  }

  setPanelOpen(panelOpen: boolean): void {
    this.update({ ...this.preferences, panelOpen });
  }

  setPlayOnPlace(playOnPlace: boolean): void {
    this.update({ ...this.preferences, playOnPlace });
  }

  private update(next: SongSheetPreferences): void {
    const current = this.preferences;
    if (
      next.numerals === current.numerals &&
      next.lyricSize === current.lyricSize &&
      next.panelOpen === current.panelOpen &&
      next.playOnPlace === current.playOnPlace
    ) {
      return;
    }
    this.subject.next(next);
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Full or refused: the choice holds for this visit (see the class comment).
    }
  }

  /** The stored preferences, each one that reads as valid kept and the rest defaulted. */
  private read(): SongSheetPreferences {
    let stored: unknown;
    try {
      stored = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? 'null');
    } catch {
      return DEFAULTS;
    }
    if (typeof stored !== 'object' || stored === null) return DEFAULTS;

    const { numerals, lyricSize, panelOpen, playOnPlace } = stored as Record<string, unknown>;
    return {
      numerals: typeof numerals === 'boolean' ? numerals : DEFAULTS.numerals,
      lyricSize: LYRIC_SIZES.includes(lyricSize as LyricSize) ? (lyricSize as LyricSize) : DEFAULTS.lyricSize,
      panelOpen: typeof panelOpen === 'boolean' ? panelOpen : DEFAULTS.panelOpen,
      playOnPlace: typeof playOnPlace === 'boolean' ? playOnPlace : DEFAULTS.playOnPlace
    };
  }
}
