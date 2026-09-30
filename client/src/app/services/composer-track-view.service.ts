import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import type * as alphaTab from '@coderline/alphatab';

import { ComposerGpService } from './composer-gp.service';
import { ComposerService } from './composer.service';
import { EMPTY_TRACK_VIEW, TrackRow, TrackView, hideRefusalOf } from './composer-track-rows';

/**
 * What the page keeps about its tracks beside the score: which are hidden, and in Original which the player mutes and
 * solos (`TrackView`). The strip changes it and the score draws and plays from it, so it is a root service both read.
 *
 * It starts again whenever what the page shows changes: a file opening takes its mute and solo from what the file
 * itself declares, and another composition - a load, New, Convert - shows every track again.
 */
@Injectable({ providedIn: 'root' })
export class ComposerTrackViewService {
  private readonly subject = new BehaviorSubject<TrackView>(EMPTY_TRACK_VIEW);
  private documentId: number | null = null;

  constructor(gp: ComposerGpService, composer: ComposerService) {
    gp.getState().subscribe(original => this.subject.next(original ? viewOfFile(original.score) : EMPTY_TRACK_VIEW));
    composer.getState().subscribe(state => {
      if (this.documentId !== null && state.documentId !== this.documentId && !gp.isOriginal) this.subject.next(EMPTY_TRACK_VIEW);
      this.documentId = state.documentId;
    });
  }

  getView(): Observable<TrackView> {
    return this.subject.asObservable();
  }

  get view(): TrackView {
    return this.subject.getValue();
  }

  /** Shows the row at `index`, or hides it - or returns why not: it is the last one shown (`hideRefusalOf`). */
  toggleShown(rows: readonly TrackRow[], index: number): string | null {
    const row = rows.find(candidate => candidate.index === index);
    if (!row) return null;
    const refusal = hideRefusalOf(rows, index);
    if (refusal) return refusal;
    this.subject.next({ ...this.view, hidden: toggled(this.view.hidden, row.key) });
    return null;
  }

  /** The player's mute on the file's track `key`, in Original. */
  toggleMuted(key: string): void {
    this.subject.next({ ...this.view, muted: toggled(this.view.muted, key) });
  }

  /** The player's solo on the file's track `key`, in Original. */
  toggleSoloed(key: string): void {
    this.subject.next({ ...this.view, soloed: toggled(this.view.soloed, key) });
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
