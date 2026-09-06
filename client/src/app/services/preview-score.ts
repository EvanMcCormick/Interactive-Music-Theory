import { BarDoc, BeatDoc, ScoreDoc, StaffDoc, TrackDoc } from '../models/composer.model';
import { DetectedNote, TranscriptionSession } from '../models/transcription.model';
import { DerivedScore, placeDetectedNotes } from './score-derivation';
import { PlacedNote, quantizeBar } from './transcription-quantize';

/**
 * Draws what the pipeline threw away, alongside what it kept.
 *
 * A derived score is a set of decisions, and only half of them are visible in
 * it. `deriveScore` reports every note it dropped and why; detection reports
 * the harmonic partials it suppressed - on real output, three quarters of what
 * the model heard. A reader looking at the score cannot tell an empty bar that
 * was silent from an empty bar whose every note fell below the confidence
 * floor, and cannot judge whether a discard was right without seeing it in the
 * place and the rhythm where it was made.
 *
 * So the discards go back into the score as ghost notes, in the bar their
 * onset falls in, positioned by exactly the rules that positioned the notes
 * around them - `placeDetectedNotes` is shared with `deriveScore` for that
 * reason, and duplicating it here would produce ghosts that drift out of step
 * with the score they annotate.
 *
 * They go in as **voice 2**. Merging them into voice 1 could not offer the
 * guarantee that makes this trustworthy: adding onsets changes clustering,
 * quantization and fingering, so the previewed score would no longer be the
 * one that exports. *Open in Composer* sends `derived.doc`, never this, and
 * voice 1 here is `derived.doc`'s voice 1 - the same objects, not a copy of
 * them.
 *
 * ## Why voice 1 is shared rather than copied
 *
 * Not for safety. Sharing is what would let a mutation *propagate*; a deep copy
 * is what would stop one. What sharing buys is provenance and cost: object
 * identity is a checkable statement that the previewed voice 1 was carried
 * across rather than rebuilt under slightly different rules, which is the one
 * failure a preview must not have, and it is free.
 *
 * The safety rests on two facts about the callers instead. `ScoreDocMapperService`
 * only reads the document - it walks it into alphaTab's own model and writes
 * nothing back. And `ComposerService.commit` `structuredClone`s the document
 * before it hands a draft to any mutation, so an edit made in the composer
 * cannot reach either of these. Neither is something this module enforces; both
 * are things it depends on, which is why they are written down here.
 *
 * Pure, with no Angular or audio dependency, following the `staff-pitch.ts`
 * precedent.
 */

/**
 * Ghost candidates gathered from a derivation and its detection.
 *
 * The two sources are disjoint by construction: `dropped` comes from
 * `session.notes`, and suppression removed its notes before `session.notes`
 * existed. Nothing here depends on that, but a note handed in twice is drawn
 * twice.
 */
function ghostCandidates(
  derived: DerivedScore,
  suppressed: DetectedNote[],
  omitted: DetectedNote[] | undefined
): DetectedNote[] {
  const candidates: DetectedNote[] = [];

  for (const note of derived.dropped) {
    if (Number.isFinite(note.note.onsetSec)) candidates.push(note.note);
    else omitted?.push(note.note);
  }

  for (const note of suppressed) {
    if (Number.isFinite(note.onsetSec)) candidates.push(note);
    else omitted?.push(note);
  }

  return candidates;
}

/** A beat list with every note in it marked as a ghost. */
function asGhosts(beats: BeatDoc[]): BeatDoc[] {
  return beats.map(beat => ({
    ...beat,
    notes: beat.notes.map(note => ({
      ...note,
      effects: { ...note.effects, isGhost: true }
    }))
  }));
}

/**
 * Adds discarded detections to a derived score as ghost notes in voice 2.
 *
 * `suppressed` is what harmonic suppression removed at detection time -
 * `session.rawNotes` less `session.notes`. It is a parameter rather than
 * something computed here because the session states the relationship as
 * identity between the two arrays, and re-deriving it by pitch and onset would
 * be a second, weaker rule.
 *
 * `omitted`, if given, collects the candidates that do not appear, and every
 * candidate either appears or lands there:
 *
 *     candidates === ghost heads drawn + omitted.length
 *
 * Three ways a candidate is lost, and all three report here. A pitch no
 * fingering can reach and an onset that is not a time in seconds have nowhere
 * to sit on a tab staff at all. The third is a ghost struck on a string
 * another ghost in the same slot already holds: `quantizeBar` keeps one note
 * per string, so it turns the second away, and the `dropped` out-parameter is
 * the only record of it. Not passing that argument is what made this docblock
 * false for a while - on the pinned detector fixture at a 0.7 confidence
 * floor, thirteen of thirty-three candidates disappeared with no glyph and no
 * count, because a higher floor shortens `derived.doc` and the ghosts from the
 * vanished bars all pile onto the last one, where collisions are certain.
 *
 * An out-parameter rather than a widened return, following `quantizeBar`: the
 * document is what callers are here for, and the count is a footnote a review
 * panel prints under it.
 *
 * A ghost past the end of the derived score is held in its last bar rather
 * than given a bar of its own. Extending the document would mean writing voice
 * 1 content that `derived.doc` does not contain, which is exactly the
 * guarantee this function exists to keep; and a discard after the last written
 * note is at the end of the piece either way.
 *
 * ## Every bar gets the ghost voice, or none does
 *
 * alphaTab requires the voice count never to fall from one bar to the next:
 * `Voice._chain` reads `bar.nextBar.voices[this.index]` for the last beat of
 * every voice and dereferences it unchecked, so a bar carrying voice 2
 * followed by a bar that does not throws a TypeError out of `Score.finish` -
 * before anything is drawn, taking the whole preview with it. Giving the ghosts
 * only to the bars that have them is therefore not available, however much
 * tidier it would be.
 *
 * The cost is a full-bar rest in voice 2 of every bar that discarded nothing,
 * which alphaTab draws: a small grey rest under each such bar. It is the
 * renderer's business rather than the document's, and a renderer can decline
 * to draw it - marking the beats of a rest-only voice `isEmpty` after mapping
 * keeps that voice out of `Bar.filledVoices`, and out of the glyphs entirely.
 * A document that quietly omitted the voice instead would just crash.
 *
 * A derivation with nothing to ghost gets no second voice at all, which is the
 * same rule read the other way: the voice count is uniform either way, so
 * alphaTab is satisfied, and a clean transcription is not annotated with a
 * column of rests saying so.
 */
export function buildPreviewDoc(
  session: TranscriptionSession,
  derived: DerivedScore,
  suppressed: DetectedNote[],
  omitted?: DetectedNote[]
): ScoreDoc {
  const doc = derived.doc;
  const candidates = ghostCandidates(derived, suppressed, omitted);

  const placement = placeDetectedNotes(candidates, session);
  if (omitted) omitted.push(...placement.unplayable);

  // `StaffDoc.bars` is parallel to `masterBars`, so the master bar list is the
  // document's own statement of how many bars there are - and it holds even
  // for a document with no tracks at all.
  const lastBar = doc.masterBars.length - 1;

  const byBar = new Map<number, PlacedNote[]>();
  for (const entry of placement.placed) {
    // A document with no bars has nowhere to put anything. `deriveScore` never
    // writes one - it floors the count at 1 - but nothing here needs it to.
    if (lastBar < 0) break;

    const bar = Math.min(lastBar, entry.bar);
    const inBar = byBar.get(bar);
    if (inBar) inBar.push(entry.placed);
    else byBar.set(bar, [entry.placed]);
  }

  // Nothing to ghost, nothing to add: the preview is the derived score.
  if (byBar.size === 0) return { ...doc, tracks: [...doc.tracks] };

  const { timeSignature } = session.grid;
  const { finestDivision } = session.settings;

  // Keyed by the `PlacedNote` object rather than by an id the type does not
  // carry, exactly as `deriveScore` names its own quantization losses.
  const source = new Map<PlacedNote, DetectedNote>();
  for (const entry of placement.placed) source.set(entry.placed, entry.note);

  // Quantized once per bar index, *outside* the staff mapper below. A document
  // can carry several staves and each would otherwise re-quantize the same
  // ghosts, counting every string collision once per staff and reporting a
  // total larger than the number of candidates. The resulting beat lists are
  // then shared by reference across staves, which is the same stance the
  // module already takes on voice 1: nothing here or downstream writes to a
  // `BeatDoc`.
  const ghostBars: BeatDoc[][] = Array.from({ length: lastBar + 1 }, (_, index) => {
    // One array per bar, drained straight into `omitted`, so the losses come
    // out in bar order and nothing has to be matched up afterwards.
    const taken: PlacedNote[] = [];
    // `quantizeBar([])` is the full-bar rest a discard-free bar gets.
    const beats = quantizeBar(byBar.get(index) ?? [], timeSignature, finestDivision, taken);

    for (const note of taken) {
      const origin = source.get(note);
      // Sound: every element of `byBar` was registered in `source` above, and
      // `quantizeBar` only ever hands back notes it was given.
      if (origin) omitted?.push(origin);
    }

    return asGhosts(beats);
  });

  // A staff longer than `masterBars` is malformed, but it costs one line to
  // give its trailing bars the ghost voice too rather than an undefined one.
  const restBar = asGhosts(quantizeBar([], timeSignature, finestDivision));

  const withGhosts = (bar: BarDoc, index: number): BarDoc => ({
    ...bar,
    voices: [
      // Carried by reference, not copied: object identity is a checkable
      // statement that this voice was not rebuilt. See the module docblock -
      // sharing is about provenance, not safety.
      ...bar.voices,
      { beats: ghostBars[index] ?? restBar }
    ]
  });

  const previewStaff = (staff: StaffDoc): StaffDoc => ({
    ...staff,
    bars: staff.bars.map(withGhosts)
  });

  const previewTrack = (track: TrackDoc): TrackDoc => ({
    ...track,
    staves: track.staves.map(previewStaff)
  });

  return { ...doc, tracks: doc.tracks.map(previewTrack) };
}
