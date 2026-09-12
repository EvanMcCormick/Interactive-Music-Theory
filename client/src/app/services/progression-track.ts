import {
  MasterBarDoc,
  ScoreDoc,
  StaffDoc,
  TimeSignature,
  TrackDoc,
  createDefaultBar,
  effectiveTimeSignature
} from '../models/composer.model';
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
 * ## Reconciling with a score that already exists
 *
 * `mergeGeneratedTrack` is the half of this module that touches somebody else's
 * document, and every rule in it is chosen the same way: of the two answers to a
 * collision, take the one that cannot destroy work.
 *
 * Bars therefore **grow and never shrink**. A progression that fell from eight
 * bars to four leaves four bars of rest behind rather than deleting bars a
 * user's own track may be writing in - the four bars of rest are visible and
 * one keypress from gone, and the deleted bar 7 is neither. `composer.service.ts`
 * states the invariant that makes this a padding job rather than a truncation
 * one: every staff of every track has exactly `masterBars.length` bars, so
 * growing the score means growing every staff in it, generated or not.
 *
 * The merge is pure, and that is not decoration either. The Composer calls it
 * inside `commit()`, which has already taken the undo snapshot from the same
 * document it hands in as the draft; a merge that wrote through to what it was
 * given would corrupt the snapshot sitting beside it and undo would restore the
 * merged score.
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
      // A name and an id of its own, because both of the projection's are right
      // for the only track in a preview and wrong in a score that may hold
      // several: `Progression` labels two progressions identically, and the id
      // `progression` *is* identical. The id is built from the progression's,
      // so it is unique across progressions and stable across rebuilds of one -
      // Update refreshes the track it already wrote rather than introducing a
      // second one wearing its id.
      //
      // The name is only the *initial* name. `mergeGeneratedTrack` keeps
      // whatever the track in the score is already called, so this is the label
      // a track is born with; the marker's own copy of `progressionName` is
      // what stays in step with the progression afterwards. An unnamed
      // progression falls back to the projection's constant rather than
      // labelling a row in the tracks panel with the empty string.
      id: `progression-${doc.id}`,
      name: doc.name.trim() || 'Progression',
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

/**
 * A staff padded out to `barCount`, in the meter `masterBars` puts in force.
 *
 * Only ever lengthens. A staff already at or past `barCount` is handed back as
 * it is rather than sliced: `barCount` is never below the score's own bar
 * count, so a longer staff is one that arrived already breaking the invariant,
 * and quietly deleting its tail is the one thing this module will not do to
 * find out.
 */
function padStaff(staff: StaffDoc, barCount: number, masterBars: MasterBarDoc[]): StaffDoc {
  if (staff.bars.length >= barCount) return staff;

  return {
    ...staff,
    bars: [
      ...staff.bars,
      ...Array.from({ length: barCount - staff.bars.length }, (_, offset) =>
        // A bar of rests rather than an empty bar, because the caret steps
        // between a bar's rest positions - `createDefaultBar` says so - and a
        // bar holding nothing would be a bar the user cannot write in.
        createDefaultBar(staff.showTablature, effectiveTimeSignature(masterBars, staff.bars.length + offset))
      )
    ]
  };
}

/** Every staff of a track padded out to `barCount`. */
function padTrack(track: TrackDoc, barCount: number, masterBars: MasterBarDoc[]): TrackDoc {
  return { ...track, staves: track.staves.map(staff => padStaff(staff, barCount, masterBars)) };
}

/**
 * Puts a generated track into a score that already exists.
 *
 * Appends when the score holds nothing of this progression and replaces **in
 * place** when it does, because Update is a refresh of a track the user has
 * already placed among their own and moving it to the end would rearrange a
 * panel they arranged. The marker is matched by `progressionId`, so a second
 * progression sent to the same score gets a track of its own rather than
 * overwriting the first.
 *
 * The name that survives a replacement is the **incumbent's**. A track's name is
 * a label the user owns; the marker's `progressionName` is the copy that tracks
 * the progression, and it is rebuilt with the rest of the marker. So Update
 * refreshes music and leaves labels alone, which is this module's usual rule
 * once more - of the two answers, take the one that cannot destroy work.
 * Nothing renames a track today, so what this costs in the meantime is that
 * renaming the *progression* and pressing Update no longer relabels the track:
 * a stale label a user can retype, against a rename Update would silently
 * revert. Anything wanting the current progression name has the marker.
 *
 * Bars grow and never shrink; see the module docstring for why that is the rule
 * and not an implementation detail. Pure: the score handed in is returned
 * unchanged and the result shares whatever neither of them had to move.
 */
export function mergeGeneratedTrack(score: ScoreDoc, generated: GeneratedTrack): ScoreDoc {
  const progressionId = generated.track.generated?.progressionId;
  const existing =
    progressionId === undefined
      ? -1
      : score.tracks.findIndex(track => track.generated?.progressionId === progressionId);

  const barCount = Math.max(score.masterBars.length, generated.masterBars.length);

  // The score's own bars are kept as they are - a `MasterBarDoc` carries the
  // user's repeats, sections and tempo automations, and the projection knows
  // none of them. Only the bars past the score's end come from the projection,
  // where there was nothing to keep.
  const masterBars: MasterBarDoc[] = Array.from({ length: barCount }, (_, index) =>
    index < score.masterBars.length ? score.masterBars[index] : generated.masterBars[index]
  );

  const incumbent = existing === -1 ? null : score.tracks[existing];
  const named = incumbent === null ? generated.track : { ...generated.track, name: incumbent.name };
  const merged = padTrack(named, barCount, masterBars);
  const others = score.tracks.map(track => padTrack(track, barCount, masterBars));

  return {
    ...score,
    masterBars,
    tracks:
      existing === -1
        ? [...others, merged]
        : others.map((track, index) => (index === existing ? merged : track))
  };
}

/**
 * The same score with one generated track detached into an ordinary one.
 *
 * The whole of Flatten, and deliberately no more than that: the marker goes and
 * nothing else does. The track keeps its name, its id, its bars and its place
 * among the user's own, because flattening stops a track being *linked* to a
 * progression rather than changing the music it holds. Everything the marker's
 * absence unlocks - editing, saving, `generatedTrackState` answering
 * `'absent'` - then follows from one cleared field rather than from a rebuild.
 *
 * An index naming no marked track is nothing to detach, and the score is handed
 * straight back rather than copied. One guard covers all three ways of naming
 * one: `tracks[-1]` is undefined - which is the -1 `generatedTrackIndex`
 * returns for a score holding nothing of this progression - so is an index past
 * the end, and a track nobody generated has no marker to clear. Returning the
 * argument itself is the point of the no-op rather than a shortcut through it:
 * a caller comparing documents by reference sees that nothing happened.
 *
 * Pure, like its neighbours: the Composer flattens inside a command that has
 * already taken the undo snapshot from the document it hands in.
 */
export function flattenGeneratedTrack(score: ScoreDoc, trackIndex: number): ScoreDoc {
  if (!score.tracks[trackIndex]?.generated) return score;

  return {
    ...score,
    tracks: score.tracks.map((track, index) =>
      index === trackIndex ? { ...track, generated: null } : track
    )
  };
}
