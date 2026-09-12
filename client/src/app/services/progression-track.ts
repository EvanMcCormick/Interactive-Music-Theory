import { MasterBarDoc, ScoreDoc, TimeSignature, TrackDoc } from '../models/composer.model';
import { ProgressionDoc } from '../models/progression.model';
import { PROGRESSION_FINEST_DIVISION, progressionToScore } from './progression-score';

/**
 * The progression, as a track in somebody else's score.
 *
 * The arrow M4 adds, and the shortest one in the feature. `progression-score.ts`
 * already projects a whole `ScoreDoc` for the preview, so nothing here projects
 * anything: this module lifts that score's single track out, marks it with what
 * it was built from, and answers what a score can later say about it. Pure, and
 * deliberately so - no Angular, no alphaTab, and no second copy of the
 * projection's semantics to keep in step with the first.
 *
 * **Read "M4 decisions" in `docs/plans/2026-09-08-progression-composer-design.md`
 * before changing anything here.** Three of the rules below are decisions with
 * an argument recorded there rather than implementation details, and this
 * docstring points at them rather than restating them: the track is a *real*
 * member of `ScoreDoc.tracks` carrying a marker, a marker is only ever written
 * by a user action, and the score's meter wins over the progression's.
 *
 * ## Why the meter is swapped and not passed
 *
 * A generated track shares the score's `masterBars`, so it has to be barred in
 * the score's meter. `progressionTrack` gets that by projecting
 * `{ ...doc, timeSignature: meter }` rather than by teaching
 * `progressionToScore` a second meter to reconcile, and the swap is free
 * because `RollNote` beats are quarter notes and the projection's grid is
 * meter-independent - `progression-score.ts` argues that under "A beat is a
 * quarter note". Re-barring therefore moves no note, only bar lines. That
 * property is what the meter rule rests on, so it is asserted as a property
 * where the bars are actually shared, not here.
 *
 * ## Staleness is a comparison, not a diff
 *
 * `generatedTrackState` compares one number and a union, and it reports stale
 * for changes that would rebuild the identical track - a meter change, a tempo
 * change into a score that keeps its own, a setter called with the value it
 * already holds. That is the design's choice and not an oversight: the design
 * doc's "Staleness is one comparison, and it over-reports in the safe
 * direction" is where the asymmetry is argued, and `ProgressionDoc.revision`
 * carries the short form. A needless Update costs a click; a badge that says
 * current about an engraving that is not costs a user's trust in the badge.
 */

/**
 * What a score has of a progression: nothing, this version of it, or an older
 * one.
 *
 * `'stale'` is one answer to two questions - the revision moved, or the track
 * itself diverged - because the badge and the button are the same in both
 * cases. `GeneratedOrigin.source` is where the two stay distinguishable.
 */
export type GeneratedTrackState = 'absent' | 'current' | 'stale';

/** A progression projected as one track, and what the track cannot say. */
export interface GeneratedTrack {
  track: TrackDoc;
  /**
   * The bars the track's staff is written against.
   *
   * Handed out beside the track rather than folded into it because
   * `MasterBarDoc`s are the *score's*, shared by every track in it. A caller
   * putting this into an existing score has to reconcile them with the bars
   * that are already there; one building a score of its own can take them as
   * they are.
   */
  masterBars: MasterBarDoc[];
  /**
   * True when the projection stopped at `MAX_PREVIEW_BARS` and the track holds
   * less music than the progression does.
   *
   * Carried out rather than swallowed because the caller cannot recover it: a
   * truncated track is a well-formed track, and the only place the difference
   * shows is against the `ProgressionDoc` it came from. An export refuses on
   * this - a file that silently drops bars is the failure a user finds in
   * another program a week later.
   */
  truncated: boolean;
}

/**
 * Projects a progression as a track ready to be put into a score.
 *
 * The meter is the score's and not the progression's; see the module docstring
 * for why that costs nothing. `scaleIntervals` is the key's scale for spelling
 * and travels straight through to `progressionToScore`, which states what an
 * empty one means - this module is pure and has no `MusicTheoryService` to
 * resolve `key.scaleId` with, so the caller that does resolves it.
 *
 * The marker is written here because this is the only place that knows both
 * the document and the track at once. It is still only a marker: writing the
 * track into a score is a user action and belongs to the caller.
 */
export function progressionTrack(
  doc: ProgressionDoc,
  scaleIntervals: readonly number[],
  meter: TimeSignature
): GeneratedTrack {
  const projected = progressionToScore(
    { ...doc, timeSignature: meter },
    PROGRESSION_FINEST_DIVISION,
    scaleIntervals
  );

  // The projection writes exactly one track and always has - a progression is
  // one instrument by design, and the preview draws a single staff.
  const [projectedTrack] = projected.doc.tracks;

  return {
    track: {
      ...projectedTrack,
      // The projection's track is called `Progression`, which is the right name
      // for the only track in a preview and a useless one in a score that may
      // hold several. The marker keeps its own copy of the name so a track the
      // user renames still says what it came from.
      name: doc.name,
      generated: {
        progressionId: doc.id,
        progressionName: doc.name,
        source: { kind: 'revision', revision: doc.revision }
      }
    },
    masterBars: projected.doc.masterBars,
    truncated: projected.truncated
  };
}

/**
 * Index of the track `doc` generated, or -1.
 *
 * Matched on `progressionId` rather than on the presence of a marker, so a
 * score carrying a *different* progression's track carries none of this one's.
 * Two progressions can be sent to one score, and the alternative would have the
 * second one adopt the first one's track and overwrite it on Update.
 */
export function generatedTrackIndex(score: ScoreDoc, doc: ProgressionDoc): number {
  return score.tracks.findIndex(track => track.generated?.progressionId === doc.id);
}

/**
 * What this score holds of this progression.
 *
 * The one function the badge, the edit gate, and the Update button all read, so
 * that a divergence and a moved revision cannot be answered differently by two
 * callers who each remembered one of them.
 */
export function generatedTrackState(score: ScoreDoc, doc: ProgressionDoc): GeneratedTrackState {
  // `tracks[-1]` is undefined, which is the same "no marker" the optional chain
  // is already there for - so the missing-track case needs no branch of its own.
  const marker = score.tracks[generatedTrackIndex(score, doc)]?.generated;
  if (!marker) return 'absent';

  if (marker.source.kind === 'diverged') return 'stale';

  return marker.source.revision === doc.revision ? 'current' : 'stale';
}
