import * as alphaTab from '@coderline/alphatab';

import { ScoreDoc } from '../models/composer.model';

/**
 * The track strip's rows, from what the page is showing: a composition's document, or - in the Original state - the
 * alphaTab `Score` of the `.gp` file, which has no document behind it (the GP-composer design, Part 5).
 *
 * One shape for both states, so the strip draws one list and M3's mixer lands on it. Pure, and named for what it returns.
 */

/** What the page keeps about the tracks beside the score itself: never part of a document, never an edit. */
export interface TrackView {
  /**
   * The tracks not drawn, by `TrackRow.key`. A page setting in both states (design decision 15): `TrackDoc` has no
   * visibility field, and alphaTab's own is not in the model.
   */
  hidden: ReadonlySet<string>;
  /**
   * In Original, the tracks the player mutes and solos, by key: the player's, not the file's (decision 16), since there
   * is no document to write them to. Unread in Composition, where a document's `PlaybackInfoDoc` holds both.
   */
  muted: ReadonlySet<string>;
  soloed: ReadonlySet<string>;
}

/** Nothing hidden, muted or soloed. */
export const EMPTY_TRACK_VIEW: TrackView = { hidden: new Set(), muted: new Set(), soloed: new Set() };

export interface TrackRow {
  /** The track's index in its document or score. */
  index: number;
  /** What the view keeps it by: a composition's `TrackDoc.id`, which survives the tracks around it moving; a file's index. */
  key: string;
  name: string;
  /** A CSS colour. */
  color: string;
  shown: boolean;
  muted: boolean;
  soloed: boolean;
}

/** The rows `source` has, as `view` shows them. */
export function trackRowsOf(source: ScoreDoc | alphaTab.model.Score, view: TrackView): TrackRow[] {
  if (source instanceof alphaTab.model.Score) {
    return source.tracks.map((track, index) => {
      const key = String(index);
      return {
        index,
        key,
        name: track.name || `Track ${index + 1}`,
        color: track.color.rgba,
        shown: !view.hidden.has(key),
        muted: view.muted.has(key),
        soloed: view.soloed.has(key)
      };
    });
  }
  return source.tracks.map((track, index) => ({
    index,
    key: track.id,
    name: track.name,
    color: track.color,
    shown: !view.hidden.has(track.id),
    muted: track.playback.isMute,
    soloed: track.playback.isSolo
  }));
}

/** The indices of the rows drawn, in order: what `renderScore` and `api.renderTracks` are given. */
export function renderedTracksOf(rows: readonly TrackRow[]): number[] {
  return rows.filter(row => row.shown).map(row => row.index);
}

/** Why hiding the track at `index` is refused: a score draws at least one track. */
export const LAST_SHOWN_TRACK = 'At least one track is shown: show another before hiding this one.';

/** Why the row at `index` cannot be hidden, or null: it is the last one shown. Showing is never refused. */
export function hideRefusalOf(rows: readonly TrackRow[], index: number): string | null {
  const row = rows.find(candidate => candidate.index === index);
  if (!row?.shown) return null;
  return rows.filter(candidate => candidate.shown).length <= 1 ? LAST_SHOWN_TRACK : null;
}
