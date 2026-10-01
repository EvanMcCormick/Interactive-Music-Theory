import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import type * as alphaTab from '@coderline/alphatab';

import { ScoreDoc } from '../models/composer.model';
import { ComposerGpService } from './composer-gp.service';
import { ComposerService } from './composer.service';
import {
  EMPTY_TRACK_VIEW,
  TrackRow,
  TrackView,
  hiddenAfterConvertOf,
  hideRefusalOf,
  keptHiddenOf,
  nearestShownTrackOf,
  trackRowsOf
} from './composer-track-rows';

/**
 * What the page keeps about its tracks beside the score: which are hidden, and in Original which the player mutes and
 * solos (`TrackView`). The strip changes it and the score draws and plays from it, so it is a root service both read.
 *
 * It starts again whenever what the page shows changes: a file opening takes its mute and solo from what the file
 * itself declares; leaving it shows every track; and a document replaced - a load, New, an applied alphaTex draft, which
 * numbers its tracks afresh from the text - shows every track again. Convert alone keeps what was hidden: the
 * composition it makes is the file's tracks in the file's order, so the file's hidden tracks are named in it
 * (`carryThroughConvert`).
 *
 * In Composition no track is left hidden that the document no longer has, and never every track (`keptHiddenOf`). In
 * either state the caret is moved off a track as it is hidden, and a keyboard track move passes over hidden tracks
 * (`ComposerService.passOverTracks`, `ComposerGpService.passOverTracks`): an edit there would write to a staff no one can
 * see - in Original once Convert has run it.
 */
@Injectable({ providedIn: 'root' })
export class ComposerTrackViewService {
  private readonly subject = new BehaviorSubject<TrackView>(EMPTY_TRACK_VIEW);
  /** The file's hidden tracks, named as the composition Convert is about to put in place names them, until it is. */
  private carried: ReadonlySet<string> | null = null;

  constructor(
    private readonly gp: ComposerGpService,
    private readonly composer: ComposerService
  ) {
    gp.getState().subscribe(original => {
      if (original) this.subject.next(viewOfFile(original.score));
      else if (this.view !== EMPTY_TRACK_VIEW) this.subject.next(EMPTY_TRACK_VIEW);
    });
    // `ComposerGpService` hears the composer first, having been made first, so a Convert or a load has already left
    // Original here. In Original the document is the empty one under the file, which says nothing about its tracks.
    composer.getState().subscribe(state => {
      if (gp.isOriginal) return;
      const hidden = keptHiddenOf(this.view.hidden, state.doc);
      if (hidden !== this.view.hidden) this.subject.next({ ...this.view, hidden });
    });
    composer.getDocumentReplacements().subscribe(() => {
      const carried = this.carried;
      this.carried = null;
      if (gp.isOriginal) return;
      const next = carried && carried.size > 0 ? { ...EMPTY_TRACK_VIEW, hidden: carried } : EMPTY_TRACK_VIEW;
      if (next !== this.view) this.subject.next(next);
      this.moveCaretOffHidden();
    });
    composer.passOverTracks(track => !gp.isOriginal && this.view.hidden.has(track.id));
    // The file's caret too, whose rows are keyed by index (`trackRowsOf`).
    gp.passOverTracks(index => this.view.hidden.has(String(index)));
  }

  getView(): Observable<TrackView> {
    return this.subject.asObservable();
  }

  get view(): TrackView {
    return this.subject.getValue();
  }

  /**
   * Shows the row at `index`, or hides it - or returns why not: it is the last one shown (`hideRefusalOf`). Hiding the
   * caret's own track moves the caret to the nearest track shown - the file's caret, in Original.
   */
  toggleShown(rows: readonly TrackRow[], index: number): string | null {
    const row = rows.find(candidate => candidate.index === index);
    if (!row) return null;
    const refusal = hideRefusalOf(rows, index);
    if (refusal) return refusal;
    this.subject.next({ ...this.view, hidden: toggled(this.view.hidden, row.key) });
    this.moveCaretOffHidden();
    return null;
  }

  /**
   * Convert keeps the file's hidden tracks hidden: told by `GpConversionService` with the composition it is about to put
   * in place (`hiddenAfterConvertOf`), which the replacement that follows shows as this view.
   */
  carryThroughConvert(doc: ScoreDoc): void {
    this.carried = hiddenAfterConvertOf(this.view.hidden, doc);
  }

  /** The player's mute on the file's track `key`, in Original. */
  toggleMuted(key: string): void {
    this.subject.next({ ...this.view, muted: toggled(this.view.muted, key) });
  }

  /** The player's solo on the file's track `key`, in Original. */
  toggleSoloed(key: string): void {
    this.subject.next({ ...this.view, soloed: toggled(this.view.soloed, key) });
  }

  /**
   * Puts the caret on the nearest track shown, when its own is hidden: the same bar, on that track's first beat. In
   * Original it is the file's caret, over the file's rows, which `setCursor` reaches there (`ComposerService.lendCaret`).
   */
  private moveCaretOffHidden(): void {
    const original = this.gp.original;
    const cursor = original ? this.gp.caret?.cursor : this.composer.state.cursor;
    const rows = trackRowsOf(original ? original.score : this.composer.state.doc, this.view);
    if (!cursor || rows[cursor.trackIndex]?.shown !== false) return;
    const trackIndex = nearestShownTrackOf(rows, cursor.trackIndex);
    if (trackIndex !== null) this.composer.setCursor({ trackIndex, staffIndex: 0, voiceIndex: 0, beatIndex: 0 });
  }
}

/** A file as it opens: every track shown, and muted and soloed as the file itself declares. */
function viewOfFile(score: alphaTab.model.Score): TrackView {
  const keysWhere = (test: (track: alphaTab.model.Track) => boolean): Set<string> =>
    new Set(score.tracks.flatMap((track, index) => (test(track) ? [String(index)] : [])));
  return { hidden: new Set(), muted: keysWhere(track => track.playbackInfo.isMute), soloed: keysWhere(track => track.playbackInfo.isSolo) };
}

function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}
