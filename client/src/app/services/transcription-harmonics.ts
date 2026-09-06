import { DetectedNote } from '../models/transcription.model';

/**
 * Removes the harmonic partials a note detector reports alongside the notes
 * actually played.
 *
 * A plucked string radiates most of its energy at the fundamental but plenty
 * at 2f0, 3f0, 4f0 and beyond, and a pitch detector reports those as notes.
 * Measured across the sixteen Karplus-Strong materials in `harmonic-eval/`,
 * Basic Pitch returns **310 notes for 182 played** — 72.0 % recall at 42.3 %
 * precision — with the spurious ones overwhelmingly partials *above* a
 * fundamental. Constraining the detector's frequency range barely helps,
 * because the partials fall inside the instrument's range too.
 *
 * That headline used to read "thirty-four notes for eight played, precision
 * 24 %", off a synthetic bassline whose partials were given decay rates the
 * rule below then claimed to exploit. The figure was true of that audio and
 * useless as evidence; `transcription-harmonics.spec.ts` says what went wrong
 * with it.
 *
 * What makes this tractable is that a partial is always *above* its
 * fundamental — physics, not a heuristic. So: consider notes lowest first, and
 * drop any that a lower note already explains as one of its partials — one it
 * overlaps, starts no earlier than, and that the detector was less sure of.
 * Overlap alone is not enough; that would delete octave leaps and slapped pops
 * along with the artefacts. Ordering by pitch guarantees a fundamental has been
 * considered before anything it could explain, without assuming it is the
 * louder of the two. It often is not: in the measured output an octave partial
 * comes back with a `confidence` of 0.548 against the 0.520 of the E1 that
 * produced it.
 *
 * ## What separates a partial from a note, and what does not
 *
 * This module shipped believing that a partial "decays faster than its
 * fundamental, so it sounds for less of it", and arbitrated the partial branch
 * on a duration ratio. Both halves of that were wrong.
 *
 * The physics is wrong. Measured on the synthesis the accuracy fixtures are
 * built from, partials 1 through 8 of an E1 decay at **−20.0 to −20.7 dB/s** —
 * a spread of 0.7 dB/s across the whole series. Differential damping is not
 * something a rule could be built on; there is almost nothing there to
 * measure. What does differ is where the partials *start*: 8–35 dB below the
 * fundamental. A detector's note therefore ends sooner not because the partial
 * damps faster but because it begins nearer the frame threshold and crosses it
 * earlier — a fact about the threshold, not about the string.
 *
 * The rule was wrong too, and by more than the story behind it. Over the 120
 * candidate pairs this branch arbitrates across the sixteen fixtures in
 * `harmonic-eval/harmonic-accuracy.spec.ts` — 92 artefacts and 28 real notes —
 * a length ratio under the shipped 0.9 removed 62 of the 92 artefacts and
 * destroyed **20 of the 28 real notes**. Even at its best achievable cut,
 * 0.325, it removed 41 artefacts for 7 real notes. It was barely better than a
 * coin.
 *
 * ## What the rule rests on now
 *
 * `DetectedNote.confidence`, compared against the root's. It is worth being
 * exact about that quantity, because the obvious reading of it is false and
 * the false reading is how the duration rule got justified.
 *
 * It is **not** amplitude. `basic-pitch-detector.ts` says what it is: the mean
 * frame activation over the note's span, bounded below by the model's own 0.3
 * frame threshold by construction. Measured across the six fixtures that carry
 * dynamics — 49 notes spanning 17.7 dB of pluck strength — its correlation
 * with velocity is **r = 0.182**, and the mean confidence of the softest notes
 * is 0.954 of the mean of the loudest, against a physical amplitude ratio near
 * 0.3. On the `accents` fixture the loud downbeat roots come back at 0.46
 * while the offbeat octaves plucked at a third of their strength come back at
 * 0.62: the quiet notes score *higher*. So no claim about how far below its
 * fundamental a partial starts is a claim about this number, and the rule
 * below is not an amplitude rule however much it looks like one.
 *
 * What it is, is a claim about the **detector**: the model is less certain
 * about a partial than about the note that produced it. Energy at a partial's
 * frequency lights that pitch bin, but a ringing partial does not look to the
 * model like a note being *played* there, so its frame activations sit nearer
 * the 0.3 floor and the mean over the span sits lower. Measured, that is worth
 * a good deal more than length: over the same 120 pairs a confidence ratio
 * under 0.65 removes **53 of 92 artefacts for 2 of 28 real notes**, where the
 * best length cut anywhere costs 7. This is a property of the model rather
 * than of strings, and it is calibrated against captured output of that model
 * — behind a different detector it would have to be measured again.
 *
 * It is also nothing like a clean separation, and should not be read as one.
 * The two distributions overlap heavily: artefacts run 0.33–1.33 with a median
 * of 0.61, real notes 0.49–2.53 with a median of 0.90. Every cut costs
 * something. `harmonic-accuracy.spec.ts` reports the trade-off curve the
 * default was chosen from.
 *
 * ## On real audio the confidence ratio separates nothing, and no value of it
 * ## would
 *
 * The paragraphs above are true of the sixteen Karplus-Strong materials the
 * ratio was calibrated on. `harmonic-eval/real-material-accuracy.spec.ts`
 * measures the same quantity on a real bass stem — 1224 frozen detections, the
 * first real material this module has ever been shown — and the calibration
 * does not survive it. Restricted to pairs struck together at a partial
 * interval, which is the population the partial branch actually arbitrates:
 *
 * | population                        |   n | min  |  q1  | med  |  q3  | max  |
 * |-----------------------------------|-----|------|------|------|------|------|
 * | synthetic **artefacts**           |  59 | 0.33 | 0.44 | 0.49 | 0.55 | 0.94 |
 * | synthetic **real notes**          |   6 | 0.96 | 1.07 | 2.46 | 2.48 | 2.55 |
 * | **real stem, partials**           | 218 | 0.37 | 0.50 | 0.60 | 0.73 | 1.41 |
 *
 * On synthesis the two populations do not touch — 0.94 against 0.96 — so any
 * cut in that 0.02-wide gap is perfect and 0.65 sits in it. Real material
 * fills the gap: 15 % of its partials sit above 0.81, the first quartile of
 * the synthetic real-note population, and 67 of them survive the pass on this
 * clause and on nothing else — not the onset guard, not the overlap window,
 * not a missing interval.
 *
 * So `partialConfidenceRatio` was never miscalibrated. The fixture was too
 * easy, and it hid that the discriminator has no separating power on real
 * audio. Moving it does not help, because on real material there is nothing on
 * the other side of any cut: a flat 1.20 takes the surviving pairs from 86 to
 * 10 and destroys **24** real notes on synthesis against the current three.
 * Two hypotheses that would have kept the ratio and scaled it were measured
 * and refuted; `real-material-accuracy.spec.ts` carries both, so neither gets
 * retried from memory.
 *
 * `monophonic` below is what this module does about it, and it is deliberately
 * not another threshold.
 *
 * Pure, and independent of any detector.
 */

/**
 * Semitone offsets of the partials a plucked string produces, relative to its
 * fundamental. 2f0 = +12, 3f0 = +19.02, 4f0 = +24, 5f0 = +27.86, 6f0 = +31.02,
 * rounded because detectors report integer MIDI pitches.
 *
 * 0 is included: a unison "partial" is the detector reporting one note twice.
 *
 * ## Every one of these was re-measured after the discriminator changed
 *
 * They had to be. Under the duration rule this list looked half rotten: +19
 * was net harmful (4 artefacts against 5 real notes), and +24 was **pure
 * harm** — 0 artefacts removed, 4 real notes destroyed. Pruning on that would
 * have been the obvious move and it would have been wrong, because those
 * numbers were a property of the clause doing the arbitrating and not of the
 * intervals. Re-measured over the same sixteen fixtures with the confidence
 * clause in place (`harmonic-eval/harmonic-accuracy.spec.ts` prints this):
 *
 * | interval | artefacts removed | duplicates of a surviving note | real notes destroyed |
 * |----------|-------------------|--------------------------------|----------------------|
 * |       +0 |                16 |                             12 |                    1 |
 * |      +12 |                58 |                              0 |                    2 |
 * |      +19 |                 9 |                              0 |                    0 |
 * |      +24 |                 3 |                              0 |                    0 |
 * |      +28 |                 0 |                              0 |                    0 |
 * |      +31 |                 0 |                              0 |                    0 |
 *
 * +24 reversed outright: 0-for-4 became 3-for-0. Dropping it from this array
 * and re-running the whole measurement costs 0.3 points of F1 and 0.5 of
 * precision for nothing back. +19 the same, at 1.3 points. So nothing here is
 * pruned: no interval both fires and is wrong.
 *
 * ## +28 and +31 are unmeasured, which is not the same as unsupported
 *
 * They have never fired, on any material. That is the whole of what is known
 * about them, and it is not evidence against them: across all 310 detections
 * there are exactly **two** pairs 28 semitones apart and two 31 apart, and
 * none of the four overlap in time, so the clause has never once been offered
 * the choice. The reason is in the synthesis rather than in the detector — a
 * triangular pluck rolls off as 1/k², putting the 5th and 6th modes 28-34 dB
 * below the fundamental, where the model does not report them at all.
 *
 * Removing them on that silence would repeat, in a new costume, exactly the
 * mistake this whole exercise exists to undo: reading a number gathered under
 * conditions that could not produce it as though it were a verdict. They stay,
 * on the physics, flagged as unmeasured. Real recordings — with body
 * resonance, inharmonicity and a pickup that does not roll off at 1/k² — are
 * what would say. `harmonic-accuracy.spec.ts` asserts that the fixture still
 * contains no such pair, so the day a capture produces one, the claim in this
 * paragraph fails rather than quietly going stale.
 */
export const HARMONIC_SEMITONES: number[] = [0, 12, 19, 24, 28, 31];

export interface HarmonicOptions {
  /** Slack at both ends of a fundamental's span, for detector jitter. */
  toleranceSec: number;
  /**
   * A unison counts as a re-detection only below this share of the root's
   * confidence.
   *
   * Was `unisonAmplitudeRatio`, which named a quantity it never compared: it
   * reads `DetectedNote.confidence`, exactly as `partialConfidenceRatio` does,
   * and that is not a level. Renamed alongside it rather than left as the one
   * misleading name beside a corrected one. The threshold itself is unchanged
   * and is still the M2 number, not a measured one.
   */
  unisonConfidenceRatio: number;
  /** ...and this share of its duration. */
  unisonDurationRatio: number;
  /**
   * How sure of a partial the detector is, relative to the note under it.
   *
   * Named for the quantity it compares and not for the one a reader expects:
   * `DetectedNote.confidence` is a mean frame activation, not a level, and it
   * does not track how hard a note was played (r = 0.182 over 17.7 dB). This
   * is a statement about the model's certainty, not about acoustics. The
   * module docblock argues why that separates partials from notes at all, and
   * why the duration rule it replaced did not.
   *
   * 0.65 chosen from the 120-pair trade-off curve in
   * `harmonic-eval/harmonic-accuracy.spec.ts`, weighting one destroyed real
   * note as five kept artefacts. That objective is flat to within two artefacts
   * across the whole of [0.615, 0.670]; 0.65 is the point in that band with
   * margin, sitting in an empty 0.649–0.661 stretch of the data with the
   * nearest real note 0.020 above it. The argmax itself, 0.670, sits 0.0001
   * below a real note: fitted rather than chosen.
   */
  partialConfidenceRatio: number;
}

export const DEFAULT_HARMONIC_OPTIONS: HarmonicOptions = {
  toleranceSec: 0.03,
  unisonConfidenceRatio: 0.8,
  unisonDurationRatio: 0.5,
  partialConfidenceRatio: 0.65
};

/**
 * How far apart two onsets may fall and still be one attack, for `monophonic`.
 *
 * ## It is a frame count, not a threshold, and it must not be rounded off
 *
 * Basic Pitch reports on frames of 256 samples at 22.05 kHz, so an onset lag
 * is quantised to multiples of **11.61 ms** and this number cannot vary
 * continuously: it picks how many frames count as together, and every value
 * between two grid points names the same rule.
 * `harmonic-eval/real-material-accuracy.spec.ts` prints the grid off the real
 * stem and asserts it. Under 50 ms the lags that occur are 0, 11.6, 23.2,
 * 34.8 and 46.4 ms, plus a 1.3 ms step that appears at model-window
 * boundaries.
 *
 * So three grid points sit at or under 30 ms and the next is clear of it, with
 * 6.8 ms of margin below and 4.8 ms above — anything from about 24 to 34 ms is
 * this same rule. Measured on the real stem, one frame (a 20 ms window) leaves
 * **16** surviving pairs at a partial interval, all of them a clean two frames
 * apart; two frames takes them all, to zero. That is where the number comes
 * from, and 25 ms or 35 ms would not be a different setting.
 *
 * A different detector, or a different hop, moves the grid and this with it.
 *
 * Not on `HarmonicOptions`, and not a knob: the three ratios there are a
 * calibration over a population, and this is arithmetic about the detector's
 * output format. There is nothing here for a listener to trade off.
 */
export const MONOPHONIC_ATTACK_SEC = 0.03;

/**
 * Per-note verdicts that outrank the thresholds, by `DetectedNote.id`.
 *
 * The thresholds above are a calibration over 120 candidate pairs, and a
 * calibration is a statement about a population rather than about the note in
 * front of the user. Measured over the sixteen accuracy fixtures the pass
 * still destroys three real notes and still keeps sixty artefacts, and no
 * value of `partialConfidenceRatio` fixes either without making the other
 * worse - the two distributions overlap from 0.49 to 1.33. So the last word
 * has to belong to whoever can hear the recording.
 *
 * ## These are decisions, not hints
 *
 * A note in `keep` is not weighted towards survival, it survives: the
 * `explains` clause is never asked about it. A note in `drop` is removed
 * without being offered a root. That is the point of applying them here rather
 * than patching the returned lists afterwards, which would put the notes back
 * in the wrong order and give the kept set two places to be decided.
 *
 * ## A kept note can then explain its own partials
 *
 * Deliberate, and a consequence of applying them at the decision point. The
 * greedy loop only ever consults notes already in `kept`, and it walks the
 * detection lowest pitch first, so a restored note joins `kept` at its own
 * pitch - strictly before anything it could explain, since a partial is always
 * *above* its fundamental. If the user says a note is real then its partials
 * are real partials, and they become suppressible in the same pass rather than
 * needing a second one.
 *
 * ## `keep` wins a note listed in both
 *
 * The two fields contradict each other and something has to give, so it is
 * stated here rather than left to whichever `Set` is consulted first.
 * `TranscriptionService.toggleNote` cannot produce the overlap - it removes an
 * id from one list rather than adding it to the other - but this function is
 * exported and pure, and a caller assembling `NoteDecisions` by hand deserves
 * an answer that does not depend on the order of two lines.
 *
 * `keep` rather than `drop` because that is the direction the whole
 * calibration leans: `partialConfidenceRatio`'s default was chosen weighting
 * one destroyed real note as five kept artefacts, and a tie broken towards
 * suppression would be the one place in the module that valued them the other
 * way round.
 *
 * ## An id in neither list, and an id in neither detection
 *
 * Both are ignored. The sets are consulted by id and nothing enumerates them,
 * so an id naming no note here costs a `Set` entry and changes no answer. That
 * matters because the ids arrive from a UI: a click resolved against one
 * session can land after a second `transcribe` has replaced it, and a throw
 * there would escape into a mouse handler.
 */
export interface NoteDecisions {
  /** Never suppress these, whatever the thresholds say. */
  keep: readonly string[];
  /** Always suppress these, whatever the thresholds say. */
  drop: readonly string[];
}

/**
 * No note overridden - what the pass runs with until the user says otherwise.
 *
 * Frozen, and shared rather than rebuilt per caller. Every producer of a
 * `NoteDecisions` in this codebase builds a new object rather than mutating
 * one, so sharing is safe; freezing is what keeps it so. Sharing also gives
 * the identity `TranscriptionService.rederive` skips work on - a session that
 * has never overridden anything holds this exact object, so "did the decisions
 * move?" is a reference comparison.
 */
export const NO_NOTE_DECISIONS: NoteDecisions = Object.freeze({
  keep: Object.freeze([]),
  drop: Object.freeze([])
});

/** Reading order for both lists this module hands back: earliest first. */
function byOnsetThenPitch(a: DetectedNote, b: DetectedNote): number {
  return a.onsetSec - b.onsetSec || a.pitch - b.pitch;
}

/**
 * Removes the partials, and reports what it removed.
 *
 * `suppressed`, if given, collects the notes that did not survive - three
 * quarters of a real detection, and until M2's review the largest discard in
 * the whole pipeline with no record anywhere. `DerivedScore.dropped` exists so
 * a `ScoreDoc` can say why a bar is empty and M3 can render a rejected note
 * greyed rather than let it vanish; suppression happens before derivation ever
 * sees the notes, so without this its losses are invisible to that mechanism.
 * They are worth seeing: measured over the sixteen accuracy fixtures this
 * still destroys three real notes it cannot give back, and a user currently
 * has no way to notice.
 *
 * An out-parameter rather than a widened return, matching `quantizeBar`: the
 * kept notes are what the whole module is about, and twenty-eight call sites
 * in the specs assert on them and nothing else.
 *
 * `decisions` are the user's per-note overrides, and they are consulted here,
 * inside the greedy walk, rather than applied to the two lists afterwards. See
 * `NoteDecisions`: the ordering, the eligibility of a restored note to act as
 * a root, and the arbitration of a note named in both lists all follow from
 * that placement. With `NO_NOTE_DECISIONS` - the default - nothing about the
 * pass changes, which is what keeps the accuracy harness measuring the
 * algorithm rather than the override path.
 *
 * `thresholds` was called `overrides`, from when there was only one kind of
 * override in play. It is the *option* overrides: a partial `HarmonicOptions`
 * spread over the defaults. Renamed rather than left sitting next to a
 * parameter that overrides something else entirely.
 *
 * `monophonic` is a statement about the **source**, not a fourth threshold.
 * See `explains`, which is where it acts, for what it does and why it is not
 * one. `false` — the default — is the pass exactly as it was: the clause is
 * one `if` that cannot be reached, and the accuracy harness runs without it so
 * that it keeps measuring the algorithm rather than the declaration.
 *
 * It sits before `suppressed` rather than after it because `suppressed` is an
 * out-parameter and out-parameters go last; the cost was that every existing
 * four-argument call had to say what kind of source it is transcribing, which
 * the compiler asked for one site at a time. That is the right question to
 * have been made to answer.
 */
export function suppressHarmonics(
  notes: DetectedNote[],
  thresholds: Partial<HarmonicOptions> = {},
  decisions: NoteDecisions = NO_NOTE_DECISIONS,
  monophonic = false,
  suppressed?: DetectedNote[]
): DetectedNote[] {
  const options: HarmonicOptions = { ...DEFAULT_HARMONIC_OPTIONS, ...thresholds };

  // Membership is asked once per note against every list, so the lists become
  // sets before the loop rather than inside it. `keep` is built first and read
  // first, which is the whole of how a note in both is arbitrated.
  const keep = new Set(decisions.keep);
  const drop = new Set(decisions.drop);

  // Lowest first, so a fundamental is always considered before its own
  // partials, whatever their relative loudness. Confidence then orders notes of
  // equal pitch, which is exactly what the unison rule needs: the strong one
  // must be seen first for the weak short one to be read as its re-detection.
  // Onset breaks the remaining ties, keeping the result deterministic.
  const byPitch = [...notes].sort(
    (a, b) => a.pitch - b.pitch || b.confidence - a.confidence || a.onsetSec - b.onsetSec
  );

  const kept: DetectedNote[] = [];
  const removed: DetectedNote[] = [];
  for (const note of byPitch) {
    // The user's verdict is read before the thresholds are, not blended with
    // them, and a kept note joins `kept` here - inside the ascending walk -
    // so the notes it explains meet it as a root a few iterations later.
    if (keep.has(note.id)) {
      kept.push(note);
    } else if (
      drop.has(note.id) ||
      kept.some(root => explains(root, note, options, monophonic))
    ) {
      removed.push(note);
    } else {
      kept.push(note);
    }
  }

  if (suppressed) {
    // Same order as the kept list, so a renderer can walk the two together.
    // Appended one at a time rather than with `push(...removed)`: a long stem
    // discards thousands of partials and spreading them would eventually hit
    // the argument-count limit.
    for (const note of removed.sort(byOnsetThenPitch)) suppressed.push(note);
  }

  return kept.sort(byOnsetThenPitch);
}

/**
 * True when `note` is a partial, or a re-detection, of the lower `root`.
 *
 * ## `monophonic` is a source declaration, not a smarter threshold
 *
 * On a source that can only sound one note at a time, two detections sharing
 * an attack a harmonic interval apart *are* a partial and its fundamental, by
 * construction. Nothing has to be inferred from the pair, so nothing is: the
 * clause below returns true without reading `partialConfidenceRatio` at all.
 *
 * That is the honest framing and it is worth insisting on, because the shape
 * of the change invites the other one. This is not a better discriminator. The
 * module docblock's table is why there is no better discriminator to find: on
 * real audio the ratio's two populations run straight through each other, so
 * asking the question at all is what was wrong. A caller who can say what the
 * source is answers it from outside instead.
 *
 * ## Measured
 *
 * On the real stem, same-attack pairs at a partial interval go **67 → 0** and
 * the monophonic share of kept notes 66.4 % → 76.9 %.
 * `harmonic-eval/real-material-accuracy.spec.ts` holds both.
 *
 * On the sixteen synthetic fixtures, given only to the ones that are actually
 * monophonic, precision goes 61.2 → 61.5 with recall and the three destroyed
 * real notes unmoved: it removes artefacts and costs nothing.
 *
 * **That last number rests on two fixtures.** Only `walking` and `guitar` of
 * the sixteen are monophonic — no two of their ground-truth notes overlap —
 * so "costs nothing on synthesis" is measured over two materials and is
 * weakly established, whatever the aggregate figures look like. Applied
 * blanketly to all sixteen, which is what a caller declaring a polyphonic
 * stem monophonic would be doing, it costs seven real notes rather than three
 * and takes F1 from 65.5 to 64.6. The gate is load-bearing and the evidence
 * that it is safe is thin; a second real stem, ideally chordal, is what would
 * settle it.
 *
 * ## What it does not do
 *
 * **It does not touch the unison branch.** Interval 0 has its own two-clause
 * test, and on a monophonic source a same-attack unison is a re-detection by
 * exactly the argument above, so the question is real. It is left alone for
 * two reasons and neither is inertia.
 *
 * The first is that there is nothing to act on, anywhere. Measured on the
 * real stem, the detector reports **no** same-attack unison pair at all — not
 * one in 1224 detections, before suppression or after — and neither of the two
 * monophonic synthetic fixtures produces one either. A re-detection of the
 * same pitch arrives staggered, which is what the two-clause test was built
 * for and what its duration clause reads.
 *
 * Measured, then, extending the prior to interval 0 is exactly free: the
 * harness scores it and every column is identical to the shipped rule's. That
 * is not evidence for it. "It costs nothing" and "it does nothing" are the
 * same measurement here, and shipping a rule on it would repeat in a new
 * costume the mistake this module's docblock exists to undo — reading a number
 * gathered under conditions that could not produce it as though it were a
 * verdict. `HARMONIC_SEMITONES`' `+28` and `+31` are the same situation and
 * are treated the same way.
 *
 * The second is that the branches want to stay disjoint. A same-attack unison
 * on a monophonic source is a re-detection, but a *staggered* one is a
 * repeated note, which basslines are full of and which this module can
 * already destroy. One rule responsible for interval 0 keeps that failure to
 * one place. `measures the prior against the unison branch it does not touch`
 * in the harness carries both figures, so the day a capture produces such a
 * pair, this paragraph fails rather than quietly going stale.
 *
 * **It does not outrank the listener.** `keep` is read before this function is
 * ever called, so an explicit override still wins — see `NoteDecisions`. That
 * ordering matters more here than it did for the thresholds: a threshold is a
 * calibration the user can argue with note by note, and this is a claim about
 * the whole recording that is simply false for the one bar where they overdub
 * a double stop.
 *
 * **It still does not say so afterwards, and it does not have to.**
 * `suppressed` collects the notes this removes with no note of why, exactly as
 * it does for the ratio. The two are not equally actionable — one is undone by
 * answering a control differently and the other is not — and the review panel
 * now separates them, but not by reading a reason out of here.
 * `TranscriptionState.declarationRemovals` runs this function twice, once with
 * the flag and once without, and differences the kept sets.
 *
 * That is not a way of dodging a widening; it is the only form of the answer
 * that is right. A note this clause removes cannot then act as a root, so
 * withdrawing the declaration does two things — it restores notes, and it lets
 * restored notes explain others. Measured on the real stem, withdrawing it
 * restores 67 detections and removes 2, so the kept sets differ by 65 and
 * neither number on its own describes what the control does. A per-note reason
 * carried out of this function would have reported the 67 and been silent about
 * the 2. `harmonic-eval/removal-attribution.ts` takes the flag for the same
 * purpose on the measurement side, where a per-pair verdict is what is wanted.
 */
function explains(
  root: DetectedNote,
  note: DetectedNote,
  options: HarmonicOptions,
  monophonic: boolean
): boolean {
  const interval = note.pitch - root.pitch;
  if (!HARMONIC_SEMITONES.includes(interval)) return false;

  // The two have to be sounding at the same time. Spans must overlap rather
  // than the partial's onset falling inside its fundamental: a re-detection
  // often begins a frame or two *before* the note it duplicates, and an
  // onset-containment test would let those through.
  const overlaps =
    note.onsetSec <= root.offsetSec + options.toleranceSec &&
    root.onsetSec <= note.offsetSec + options.toleranceSec;
  if (!overlaps) return false;

  if (interval > 0) {
    // A partial is set ringing by the same pluck as its fundamental, so it
    // cannot start first. Unison is exempt on purpose: a re-detection often
    // straddles the onset of the note it duplicates, and the symmetric
    // overlap above is what catches the earlier half of such a pair.
    if (note.onsetSec < root.onsetSec - options.toleranceSec) return false;

    // The declared source, before the calibration and instead of it. Two
    // notes struck together on something that plays one note at a time are a
    // partial and its fundamental whatever the model thought of either, so
    // `partialConfidenceRatio` is not consulted rather than being consulted
    // and overruled. See this function's docblock.
    //
    // Symmetric, and it has to be: the guard above already allows the partial
    // to be detected up to `toleranceSec` *before* its own fundamental, and a
    // one-sided window would let exactly those pairs through to a clause that
    // cannot judge them.
    if (
      monophonic &&
      Math.abs(note.onsetSec - root.onsetSec) <= MONOPHONIC_ATTACK_SEC
    ) {
      return true;
    }

    // Overlap alone would delete real music: an octave leap over a ringing
    // low note, a slapped pop over its thumbed root, pumping octave eighths.
    // What survives them is that the detector is markedly less *sure* of a
    // partial than of the note that produced it — see the module docblock for
    // why that is a claim about the model rather than about the string, and
    // why the duration rule it replaced was neither well founded nor
    // effective.
    return note.confidence < root.confidence * options.partialConfidenceRatio;
  }

  // Unison needs more care. A note genuinely struck twice also overlaps itself
  // when the first one is still ringing, and suppressing that would delete
  // repeated notes — which basslines are full of. A re-detection is both
  // markedly less certain and markedly shorter than the note it duplicates; a
  // real second attack is neither.
  return (
    note.confidence < root.confidence * options.unisonConfidenceRatio &&
    note.offsetSec - note.onsetSec <
      (root.offsetSec - root.onsetSec) * options.unisonDurationRatio
  );
}
