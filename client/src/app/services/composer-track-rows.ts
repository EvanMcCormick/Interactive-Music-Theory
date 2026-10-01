import * as alphaTab from '@coderline/alphatab';

import { ScoreDoc } from '../models/composer.model';
import { LAST_SHOWN_TRACK } from './composer-text';

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
    name: track.name || `Track ${index + 1}`,
    color: track.color,
    shown: !view.hidden.has(track.id),
    muted: track.playback.isMute,
    soloed: track.playback.isSolo
  }));
}

/**
 * The indices of the rows drawn, in order: what `renderScore` and `api.renderTracks` are given. Never none while there
 * are rows: given no tracks, alphaTab draws the first with no staff slot known for it, so the caret and the hit test
 * would find nothing. `ComposerTrackViewService` keeps a hidden set from covering every track (`keptHiddenOf`); this
 * draws every row should one ever arrive here anyway.
 */
export function renderedTracksOf(rows: readonly TrackRow[]): number[] {
  const shown = rows.filter(row => row.shown).map(row => row.index);
  return shown.length > 0 ? shown : rows.map(row => row.index);
}

/** Why the row at `index` cannot be hidden, or null: it is the last one shown. Showing is never refused. */
export function hideRefusalOf(rows: readonly TrackRow[], index: number): string | null {
  const row = rows.find(candidate => candidate.index === index);
  if (!row?.shown) return null;
  return rows.filter(candidate => candidate.shown).length <= 1 ? LAST_SHOWN_TRACK : null;
}

/**
 * Where the caret goes off the hidden row at `index`: the next row shown after it, else the one before it; null with no
 * other row shown. An edit on a hidden track would write to a staff no one can see.
 */
export function nearestShownTrackOf(rows: readonly TrackRow[], index: number): number | null {
  const shown = rows.filter(row => row.shown && row.index !== index).map(row => row.index);
  return shown.find(candidate => candidate > index) ?? shown.filter(candidate => candidate < index).pop() ?? null;
}

/**
 * A composition's hidden tracks, by id, kept to the ones `doc` still has - `hidden` itself when that is all of them - or
 * none at all when they would hide every track: a Remove, or an Undo of the Add that made the one track shown, would
 * otherwise leave nothing drawn (`renderedTracksOf`).
 */
export function keptHiddenOf(hidden: ReadonlySet<string>, doc: ScoreDoc): ReadonlySet<string> {
  const kept = doc.tracks.filter(track => hidden.has(track.id)).map(track => track.id);
  if (kept.length === doc.tracks.length) return hidden.size === 0 ? hidden : new Set<string>();
  return kept.length === hidden.size ? hidden : new Set(kept);
}

/**
 * The Original's hidden tracks, kept by the file's index, as the composition Convert made of that file names them: its
 * tracks are the file's, in the file's order (`ScoreDocMapperService.toDoc`), so the index names the same track.
 */
export function hiddenAfterConvertOf(hidden: ReadonlySet<string>, doc: ScoreDoc): ReadonlySet<string> {
  return keptHiddenOf(new Set(doc.tracks.flatMap((track, index) => (hidden.has(String(index)) ? [track.id] : []))), doc);
}
