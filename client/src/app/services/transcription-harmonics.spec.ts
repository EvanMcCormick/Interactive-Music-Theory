/**
 * What `suppressHarmonics` does, pinned against detector output that was never
 * arranged to agree with it.
 *
 * ## Why every fixture here is a lookup rather than a literal
 *
 * This file used to open with thirty-four hand-copied rows called
 * `SPIKE_OUTPUT`, and the same thirty-four appeared verbatim in
 * `transcription.service.spec.ts` and `preview-score.spec.ts`. They were real
 * detector output, so they looked unimpeachable - but the *audio* they were
 * detected from was additive synthesis in which partial `h` was given a decay
 * rate `h` times the fundamental's. That is precisely the premise the duration
 * rule this module used to arbitrate on rested on, written straight into the
 * signal. Measured on a string model that asserts nothing of the kind,
 * partials 1 through 8 of an E1 damp at -20.0 to -20.7 dB/s - a spread of 0.7
 * dB/s. The old rule scored 100 % on that one fixture and 56.5 % on sixteen
 * honest ones, and nothing in this file could tell the difference.
 *
 * So the fixtures now come from `harmonic-eval/detections.fixture.ts`: frozen
 * output of the real detector on Karplus-Strong material, where the harmonic
 * structure comes out of a delay line and a loop filter rather than out of
 * anybody's expectations. One copy, sixteen materials, named by what they
 * stress. `detection(material, pitch, onsetSec)` picks a note out by identity,
 * so a re-capture that moves one fails loudly here rather than quietly
 * re-pointing a test at a different note.
 *
 * ## What the tests are allowed to assert
 *
 * Only what the capture actually contains. Four specs in the previous version
 * of this file passed while asserting figures the detector does not produce -
 * an octave leap and a slapped pop constructed as long as their roots (length
 * ratios 1.0 and 1.11, against 0.26-0.79 captured), octave eighths surviving
 * on a confidence ratio of 0.94, and a "margin" test pinning a parameter that
 * no longer exists. Every one of them passed before the discriminator changed
 * and after it, which is the definition of protecting nothing.
 *
 * Each spec below therefore names the material its numbers came from, and the
 * numbers in the comments are the captured ones. Where no capture exists - the
 * 5th and 6th partials, which this detector has never once reported - the spec
 * says so instead of inventing a pair that looks like one.
 */

import { DetectedNote } from '../models/transcription.model';
import { detection, detectionsOf } from './harmonic-eval/detections.fixture';
import { MATERIAL } from './harmonic-eval/material';
import { HARMONIC_SEMITONES, suppressHarmonics } from './transcription-harmonics';

/** [onsetSec, midiPitch, durationSec, confidence] - for the few synthetic pairs left. */
type Raw = [number, number, number, number];

function note([onsetSec, pitch, duration, confidence]: Raw, index: number): DetectedNote {
  return {
    id: `n${index}`,
    pitch,
    onsetSec,
    offsetSec: onsetSec + duration,
    confidence,
    bendCents: []
  };
}

/** The ground-truth notes of one captured material. */
function played(name: string): { pitch: number; onsetSec: number }[] {
  const material = MATERIAL.find(m => m.name === name);
  if (!material) throw new Error(`no material "${name}"`);

  return material.notes;
}

/**
 * `guitar`: twelve notes two octaves above the bass register, where a string's
 * partials fall outside the model's band and only three artefacts survive at
 * all. It is the one material in the set on which suppression recovers the
 * played line exactly, which makes it the honest home for that claim.
 */
const GUITAR = detectionsOf('guitar');

/**
 * `walking`: twelve notes of a bass line, twenty-eight detections, ten of them
 * removed. The workhorse fixture for everything about ordering, partitioning
 * and reporting, because it is long enough and messy enough for those to mean
 * something.
 */
const WALKING = detectionsOf('walking');

/** `accents`: sixteen octave eighths, root on the beat and octave off it. */
const ACCENTS = detectionsOf('accents');

const ONSET_TOLERANCE_SEC = 0.05;

describe('suppressHarmonics', () => {
  it('recovers the played line from the raw detector output', () => {
    // `guitar`, captured: fifteen detections for twelve notes played, and
    // suppression leaves exactly the twelve. The three it removes are a 64
    // riding on the E3 at 0, a 69 on the A3 at 5.01 and a 67 on the G3 at
    // 5.51 - all octave and twelfth partials the model was markedly less sure
    // of than the note under them.
    //
    // This is the strongest claim in the file and it holds on exactly one of
    // the sixteen materials. On the other fifteen suppression improves the
    // line without recovering it; `harmonic-eval/harmonic-accuracy.spec.ts`
    // is where that is measured, and 61.2 % precision is what it comes to.
    // Asserting an exact recovery anywhere else would be asserting a thing
    // that is not true.
    const kept = suppressHarmonics(GUITAR);

    expect(kept.map(n => n.pitch)).toEqual(played('guitar').map(n => n.pitch));
    // Which twelve events, not just which twelve pitches - the fixture holds
    // several detections at some of these pitches, and everything downstream
    // reads their onsets as the rhythm.
    expect(kept.map(n => n.id)).toEqual([
      'd0', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd10', 'd11', 'd13'
    ]);
  });

  it('cannot suppress a partial the detector is as sure of as the note under it', () => {
    // A limitation, asserted as one. This spec exists so that nobody
    // rediscovers it as a bug, and it is the direct successor of a spec called
    // `suppresses a partial that is louder than its own fundamental` that used
    // to pass on the compromised fixture.
    //
    // `repeats`, captured: the A1 struck at 0.4 s comes back at 0.3599 with a
    // confidence of 0.3695, and an A2 that was never played comes back at
    // 0.4063 with 0.4102. The model is 11 % *more* certain of the artefact
    // than of the note that produced it. `partialConfidenceRatio` compares
    // exactly those two numbers, so no setting of it below 1 can remove this
    // without removing every real octave in the set along with it - the real
    // ones sit at 0.67 and above, and 20 of the 28 real notes in the candidate
    // population are above 0.9.
    //
    // What would catch it is frame-level evidence: a struck note and a ringing
    // partial differ in onset sharpness and envelope long before they differ
    // in a mean activation. That reaches into the detector and the worker
    // boundary and is out of scope here; see the plan's "deliberately not in
    // scope".
    const root = detection('repeats', 33, 0.3599);
    const artefact = detection('repeats', 45, 0.4063);

    expect(artefact.confidence).toBeGreaterThan(root.confidence);
    expect(suppressHarmonics([root, artefact]).map(n => n.pitch)).toEqual([33, 45]);

    // ...and it is not an artefact of isolating the pair: the same detection
    // survives the whole material.
    expect(suppressHarmonics(detectionsOf('repeats')).some(n => n.id === artefact.id)).toBeTrue();
  });

  it('keeps an octave leap over a note that is still ringing', () => {
    // `loudOverQuiet`, captured: an E1 detected at 0.0116 and left ringing
    // 1.93 s, with the E2 struck over it detected at 0.4063 and ringing 1.52.
    // Both are notes that were played. Confidence 0.6467 against 0.5270 - the
    // detector is *more* sure of the upper note - so the partial clause does
    // not fire and the leap survives.
    //
    // The version of this spec that this replaces built the pair by hand at
    // 0.64 over 0.62 and gave both notes the same length. Real output for this
    // figure gives a length ratio of 0.79, so the rule it was nominally
    // protecting the leap from was never engaged. Delete the confidence clause
    // and this fails; that is the whole of what it is for.
    const root = detection('loudOverQuiet', 28, 0.0116);
    const leap = detection('loudOverQuiet', 40, 0.4063);

    expect(suppressHarmonics([root, leap]).map(n => n.pitch)).toEqual([28, 40]);
  });

  it('keeps a slapped pop two octaves over the thumbed note under it', () => {
    // `slap`, captured: thumb on E1 at 0.0580 ringing 0.79 s, pop on E3 at
    // 0.2090 ringing 0.21. +24 is a partial's interval and the thumbed note is
    // still sounding, so overlap alone would delete the pop.
    //
    // The captured length ratio is **0.265** - the pop is a quarter the length
    // of the note under it - which is why the rule this module used to run on
    // deleted figures like this one and took `slap` from 58.3 F1 raw down to
    // 26.7. The confidence ratio is 1.126, so the rule it runs on now keeps
    // it. The hand-built version of this spec used 1.11 as a *length* ratio
    // and 0.94 as a confidence ratio, and so failed to exercise either rule.
    const thumb = detection('slap', 28, 0.058);
    const pop = detection('slap', 52, 0.209);

    expect(
      (pop.offsetSec - pop.onsetSec) / (thumb.offsetSec - thumb.onsetSec)
    ).toBeLessThan(0.3);
    expect(suppressHarmonics([thumb, pop]).map(n => n.pitch)).toEqual([28, 52]);
  });

  it('keeps octave eighths pumping against each other', () => {
    // `accents`, captured whole: sixteen eighths at 108 BPM, root on the beat
    // and its octave off it, the offbeats plucked at a third of the weight.
    // Thirty-one detections, of which suppression removes eleven - and not one
    // of the sixteen notes played. Every offbeat is a real note at +12 over a
    // root still ringing under it, which is the figure that overlap-alone
    // suppression destroys.
    //
    // The spec this replaces built eight notes by hand with a confidence ratio
    // of 0.94, which clears the 0.65 cut with room to spare and would have
    // survived almost any rule. Captured, these offbeats come back at 1.09 to
    // 1.45 of their root's confidence - the detector is *more* certain of the
    // quiet offbeat than of the loud downbeat - and that, not anything about
    // eighths, is what saves them.
    const kept = suppressHarmonics(ACCENTS);

    for (const ref of played('accents')) {
      const found = kept.some(
        n => n.pitch === ref.pitch && Math.abs(n.onsetSec - ref.onsetSec) <= ONSET_TOLERANCE_SEC
      );
      expect(found)
        .withContext(`MIDI ${ref.pitch} at ${ref.onsetSec.toFixed(3)} s`)
        .toBeTrue();
    }

    // ...and it is still doing work on this material rather than passing by
    // keeping everything.
    expect(kept.length).toBeLessThan(ACCENTS.length);
  });

  it('pins how much less sure of a partial the detector has to be', () => {
    // The whole margin, in one test, on the pair that defines it.
    //
    // `quietOverLoud`, captured: an A1 at 2.8341 (confidence 0.7722) with a
    // softly played A2 over it at 3.2405 (0.5176). The ratio is 0.6703, and
    // across all sixteen materials it is the closest any real note comes to
    // the 0.65 cut from above - the margin the default was chosen for is
    // 0.0203 and this is the note it was measured against.
    //
    // The spec this replaces pinned `partialDurationRatio`, a parameter that
    // no longer exists; its pair survived on a confidence ratio of 0.97 and
    // said nothing about any threshold. This one moves the moment the cut
    // does.
    const root = detection('quietOverLoud', 33, 2.8341);
    const soft = detection('quietOverLoud', 45, 3.2405);

    expect(soft.confidence / root.confidence).toBeCloseTo(0.6703, 4);
    expect(suppressHarmonics([root, soft]).map(n => n.pitch)).toEqual([33, 45]);
    // A cut 0.03 higher takes it, which is what makes the margin thin rather
    // than comfortable, and why `harmonic-accuracy.spec.ts` asserts the gap.
    expect(
      suppressHarmonics([root, soft], { partialConfidenceRatio: 0.68 }).map(n => n.pitch)
    ).toEqual([33]);
  });

  it('keeps a note at a partial interval that began before its supposed root', () => {
    // A partial cannot start before the pluck that makes it.
    //
    // `walking`, captured: a G2 at 0.6037 and the G1 at 0.6385 that would
    // otherwise explain it, 34.8 ms - three detector frames - later. The
    // confidence ratio is 0.507, well under the cut, so the onset order is the
    // only thing keeping this note. Remove that guard and it goes.
    const root = detection('walking', 31, 0.6385);
    const early = detection('walking', 43, 0.6037);

    expect(early.confidence).toBeLessThan(root.confidence * 0.65);
    expect(suppressHarmonics([root, early]).map(n => n.pitch)).toEqual([43, 31]);
  });

  it('keeps a twelfth that was played, at an interval 3f0 also lands on', () => {
    // The figure `fifths` exists for. 3f0 lands an octave *and* a fifth up, so
    // +19 is both a partial's interval and a twelfth someone plays on purpose.
    //
    // `fifths`, captured: an E1 at 3.9603 left ringing 1.15 s with a B2 struck
    // over it at 4.1938. Confidence 0.4996 against 0.6319 - a ratio of 0.791,
    // above the cut with 0.14 to spare - so it survives. The plain fifth is a
    // different case and an easier one: +7 is not a partial of anything at any
    // harmonic number, so the interval gate turns it away before any of this.
    // Worth noting from the capture, since a comment here used to assert the
    // opposite: not one of the +7 pairs in `fifths` would be suppressed even
    // if +7 *were* added to HARMONIC_SEMITONES. The detector comes back more
    // certain of the fifth than of the root every time - 1.11 to 2.13 - so
    // that particular mistake would be invisible on this material, and it is
    // `leaves a note with no harmonic relation alone` below, on a pair the
    // detector is much less sure of, that would actually catch it.
    const root = detection('fifths', 28, 3.9603);
    const twelfth = detection('fifths', 47, 4.1938);

    expect(suppressHarmonics([root, twelfth]).map(n => n.pitch)).toEqual([28, 47]);
  });

  it('leaves a note with no harmonic relation alone', () => {
    // `walking`, captured: an A1 at 1.2423 ringing 441 ms, and the B1 a whole
    // tone above it detected at 1.6834 just as it ends. The detector is 0.371
    // as sure of the B1, well under the cut, and it starts well after the A1 -
    // so every other gate in the rule would let this through and only the
    // interval list keeps it. +2 is not a partial's interval at any harmonic
    // number, and this is the pair that says so.
    const lower = detection('walking', 33, 1.2423);
    const upper = detection('walking', 35, 1.6834);

    expect(upper.confidence).toBeLessThan(lower.confidence * 0.65);
    expect(suppressHarmonics([lower, upper]).length).toBe(2);
  });

  it('keeps a partial-interval note that does not overlap its root', () => {
    // `ballad`, captured: a G1 at 2.4394 ringing until 3.4262, and a detection
    // at +19 above it that does not arrive until 3.6120 - 186 ms, sixteen
    // frames, after the root has stopped. Its confidence ratio is 0.343, so
    // the clause would fire on it instantly; only the overlap gate keeps it.
    const root = detection('ballad', 31, 2.4394);
    const later = detection('ballad', 50, 3.612);

    expect(later.onsetSec).toBeGreaterThan(root.offsetSec);
    expect(suppressHarmonics([root, later]).length).toBe(2);
  });

  it('allows the root a little slack past its offset, and not much', () => {
    // Both halves captured, from two materials, at the detector's own
    // resolution: its frames are 11.6 ms apart and every onset here is a
    // multiple of that.
    //
    // Inside: `pedal`, an A1 at 4.6117 ending at 4.9136 and an A2 at 4.9252 -
    // exactly one frame past it. The 30 ms slack covers two and a half frames,
    // so this is a partial.
    //
    // Outside: `repeats`, an A1 at 0.4412 ending at 0.7547 and an A2 at 0.8011
    // - four frames past it. Its confidence ratio is 0.451, so the clause
    // would take it the moment the gate let it through; the gap is the only
    // thing keeping it.
    const insideRoot = detection('pedal', 33, 4.6117);
    const inside = detection('pedal', 45, 4.9252);
    const outsideRoot = detection('repeats', 33, 0.4412);
    const outside = detection('repeats', 45, 0.8011);

    expect(inside.onsetSec - insideRoot.offsetSec).toBeCloseTo(0.0116, 4);
    expect(outside.onsetSec - outsideRoot.offsetSec).toBeCloseTo(0.0464, 4);

    expect(suppressHarmonics([insideRoot, inside]).map(n => n.pitch)).toEqual([33]);
    expect(suppressHarmonics([outsideRoot, outside]).map(n => n.pitch)).toEqual([33, 45]);
  });

  it('takes that slack from the options it is handed', () => {
    // The same two captured pairs, moved across the boundary by changing the
    // option rather than by moving the notes.
    const insideRoot = detection('pedal', 33, 4.6117);
    const inside = detection('pedal', 45, 4.9252);
    const outsideRoot = detection('repeats', 33, 0.4412);
    const outside = detection('repeats', 45, 0.8011);

    // One frame of gap, and a slack narrower than a frame: no longer a partial.
    expect(
      suppressHarmonics([insideRoot, inside], { toleranceSec: 0.005 }).map(n => n.pitch)
    ).toEqual([33, 45]);
    // Four frames of gap, and a slack wide enough to span them: now it is.
    expect(
      suppressHarmonics([outsideRoot, outside], { toleranceSec: 0.05 }).map(n => n.pitch)
    ).toEqual([33]);
  });

  it('drops the 2nd partial, an octave up', () => {
    // `walking`, captured: a G1 at 4.2402 (confidence 0.6677) and the G2 at
    // 4.2866 it radiates (0.3228). Ratio 0.483. This is the interval that does
    // the work - 58 of the 101 removals across the sixteen materials.
    const root = detection('walking', 31, 4.2402);
    const partial = detection('walking', 43, 4.2866);

    expect(suppressHarmonics([root, partial]).map(n => n.pitch)).toEqual([31]);
  });

  it('drops the 3rd partial, an octave and a fifth up', () => {
    // 3f0 is 19.02 semitones above the fundamental. `walking`, captured: E1 at
    // 0.0116 (0.6244) and a B2 at 0.0464 (0.3778). Ratio 0.605.
    const root = detection('walking', 28, 0.0116);
    const partial = detection('walking', 47, 0.0464);

    expect(suppressHarmonics([root, partial]).map(n => n.pitch)).toEqual([28]);
  });

  it('drops the 4th partial, two octaves up', () => {
    // 4f0 is exactly 24 semitones up. `accents`, captured: A1 at 2.8109
    // (0.5790) and an A3 at 3.0547 (0.3231). Ratio 0.558.
    const root = detection('accents', 33, 2.8109);
    const partial = detection('accents', 57, 3.0547);

    expect(suppressHarmonics([root, partial]).map(n => n.pitch)).toEqual([33]);
  });

  /**
   * The 5th and 6th partials are the two intervals in `HARMONIC_SEMITONES`
   * with no captured example anywhere.
   *
   * Across all 310 detections in the sixteen materials there is not one
   * overlapping pair 28 or 31 semitones apart, because a triangular pluck rolls
   * off as 1/k^2 and puts those modes 28-34 dB below the fundamental, where
   * this model does not report them at all. `harmonic-accuracy.spec.ts`
   * asserts that emptiness, so the day a capture produces such a pair, it says
   * so.
   *
   * The two specs below are therefore **synthetic on purpose**, and are the
   * only synthetic pairs left in this file. What they pin is that the rule
   * reaches those intervals at all - a deletion from `HARMONIC_SEMITONES` has
   * to fail something - and they are labelled rather than dressed up as
   * measurements, which is exactly the failure mode the rest of this file was
   * rebuilt to remove.
   */
  describe('the two partials nothing has ever captured', () => {
    it('drops the 5th partial, nearly two octaves and a major third up', () => {
      // Synthetic: 5f0 is 27.86 semitones above the fundamental, so E1 at 28
      // would ring at 56. No detector output in the fixture contains this pair.
      const pair = [note([0, 28, 0.6, 0.6], 0), note([0.1, 56, 0.2, 0.3], 1)];

      expect(suppressHarmonics(pair).map(n => n.pitch)).toEqual([28]);
    });

    it('drops the 6th partial, two octaves and a fifth up', () => {
      // Synthetic: 6f0 is 31.02 semitones up, so E1 at 28 would ring at 59.
      // Also never captured.
      const pair = [note([0, 28, 0.6, 0.6], 0), note([0.1, 59, 0.2, 0.3], 1)];

      expect(suppressHarmonics(pair).map(n => n.pitch)).toEqual([28]);
    });
  });

  it('drops a weak short unison inside a strong note as a re-detection', () => {
    // `walking`, captured: the G1 played at 0.6 comes back twice - once at
    // 0.5457 as a 93 ms fragment at confidence 0.3414, and once at 0.6385 as a
    // 418 ms note at 0.6782. The fragment is 0.50 of the note's confidence and
    // 0.22 of its length, and it is a re-detection of it.
    //
    // Note which one starts first. The fragment precedes the note it
    // duplicates by 93 ms, which is why the unison branch is exempt from the
    // "a partial cannot start before its root" rule - and this captured pair
    // is what that exemption is for.
    const strong = detection('walking', 31, 0.6385);
    const fragment = detection('walking', 31, 0.5457);

    expect(fragment.onsetSec).toBeLessThan(strong.onsetSec);
    expect(suppressHarmonics([strong, fragment]).map(n => n.id)).toEqual([strong.id]);
  });

  it('keeps a genuine repeated note of comparable weight and length', () => {
    // `repeats`, captured: the D2 struck at 1.7 and again at 2.0 while the
    // first still rings. Confidence ratio 1.145, length ratio 1.514 - the
    // second attack is both surer and longer, which no re-detection is.
    const first = detection('repeats', 38, 1.7299);
    const again = detection('repeats', 38, 2.0214);

    expect(suppressHarmonics([first, again]).length).toBe(2);
  });

  it('keeps a softer repeat that is held nearly as long', () => {
    // Half the unison rule fires and the note survives on the other half.
    //
    // `pedal`, captured: an A1 at 3.0315 (confidence 0.7494, 372 ms) and the
    // same pitch again at 3.4030 (0.5330, 663 ms). The confidence ratio is
    // 0.711, under the 0.8 the unison clause wants - but it rings 1.79 times
    // as long, which no re-detection does. Suppressing on certainty alone
    // would delete it.
    const first = detection('pedal', 33, 3.0315);
    const softer = detection('pedal', 33, 3.403);

    expect(softer.confidence).toBeLessThan(first.confidence * 0.8);
    expect(suppressHarmonics([first, softer]).length).toBe(2);
  });

  it('keeps a staccato repeat played at full weight', () => {
    // The other half. `repeats`, captured: a C2 at 6.1223 (confidence 0.7865,
    // 441 ms) and a clipped C2 at 6.5635 (0.6958, 197 ms). The length ratio is
    // 0.447, under the 0.5 the unison clause wants - but the detector is 0.885
    // as sure of it, which a re-detection is not. Suppressing on length alone
    // would delete every clipped repeated note in a bassline.
    const first = detection('repeats', 36, 6.1223);
    const clipped = detection('repeats', 36, 6.5635);

    expect(clipped.offsetSec - clipped.onsetSec).toBeLessThan(
      (first.offsetSec - first.onsetSec) * 0.5
    );
    expect(suppressHarmonics([first, clipped]).length).toBe(2);
  });

  it('returns notes in onset order', () => {
    const kept = suppressHarmonics(WALKING);
    const onsets = kept.map(n => n.onsetSec);

    expect([...onsets].sort((a, b) => a - b)).toEqual(onsets);
  });

  /**
   * Suppression is where a third of a detection goes, and it runs before
   * derivation ever sees the notes - so unless it says what it removed, the
   * largest discard in the pipeline is invisible to the `dropped` machinery M3
   * renders.
   */
  describe('reporting what it removed', () => {
    it('hands back the partials it suppressed', () => {
      // `walking`, captured: twenty-eight detections in, eighteen kept, ten
      // reported as removed.
      //
      // The share is worth noticing. Under the duration rule this discard was
      // twenty-six of thirty-four - suppression threw away more than it kept -
      // and a spec in `transcription.service.spec.ts` asserted exactly that
      // inequality. It no longer holds anywhere in the set, because almost
      // everything the new clause removes is an artefact and there were never
      // that many artefacts. The claim that survives is the one that matters:
      // whatever it removes, it hands back.
      const suppressed: DetectedNote[] = [];
      const kept = suppressHarmonics(WALKING, {}, suppressed);

      expect(kept.length).toBe(18);
      expect(suppressed.length).toBe(WALKING.length - kept.length);
      // The two lists partition the detection: nothing invented, nothing lost.
      expect([...kept, ...suppressed].map(n => n.id).sort()).toEqual(
        WALKING.map(n => n.id).sort()
      );
    });

    it('reports them in onset order, like the kept notes', () => {
      const suppressed: DetectedNote[] = [];
      suppressHarmonics(WALKING, {}, suppressed);

      // An empty list is trivially sorted, so this has to say there is one.
      expect(suppressed.length).toBe(10);
      const onsets = suppressed.map(n => n.onsetSec);
      expect([...onsets].sort((a, b) => a - b)).toEqual(onsets);
    });

    it('appends rather than replacing, so one array can collect several passes', () => {
      const suppressed: DetectedNote[] = [];
      suppressHarmonics(WALKING, {}, suppressed);
      const first = suppressed.length;

      suppressHarmonics(WALKING, {}, suppressed);

      // ...and 0 * 2 is 0, so the same guard again.
      expect(first).toBe(10);
      expect(suppressed.length).toBe(first * 2);
    });

    it('leaves the array empty when nothing was a partial', () => {
      const suppressed: DetectedNote[] = [];
      // `walking`'s A1 and the B1 a whole tone over it - the pair from `leaves
      // a note with no harmonic relation alone`, which every gate but the
      // interval list would suppress.
      suppressHarmonics(
        [detection('walking', 33, 1.2423), detection('walking', 35, 1.6834)],
        {},
        suppressed
      );

      expect(suppressed).toEqual([]);
    });
  });

  it('does not mutate its input', () => {
    // Identities, not just the count: the pass sorts, and sorting in place
    // would leave the caller's array reordered while its length held. The
    // array has to be its own, too - the shared one has been through the
    // suppressor already, and sorting a sorted array changes nothing.
    const input = detectionsOf('walking');
    const before = input.map(n => n.id);
    suppressHarmonics(input);

    expect(input.map(n => n.id)).toEqual(before);
  });

  it('gives the same answer whatever order the detector reported the notes in', () => {
    // Fifteen of `walking`'s twenty-eight detections share a pitch with an
    // earlier one, so pitch alone leaves the greedy pass's scan order
    // undetermined and the answer would depend on what the detector happened
    // to report first. What this catches is that non-determinism: strip both
    // tie-breaks and it fails.
    //
    // Which of the two tie-breaks does it is a separate question, and worth
    // being straight about because it is easy to assert more here than is
    // true. **Confidence is load-bearing for the answer** - it decides which
    // of two same-pitch detections is the root and which the re-detection, and
    // removing it changes what the suppressor keeps on this very fixture. It
    // is not what makes the answer order-independent, though: onset alone
    // would complete the order just as well. And onset, the third key, is
    // reached by nothing: no captured pair anywhere in the sixteen materials
    // ties on both pitch and confidence, and two that did could not suppress
    // each other anyway, since the unison clause wants a strictly lower
    // confidence. It stays because it costs nothing and makes the order total;
    // a spec claiming to exercise it would be claiming something false.
    const expected = suppressHarmonics(WALKING).map(n => n.id);

    for (let trial = 0; trial < 25; trial++) {
      const shuffled = [...WALKING];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      expect(suppressHarmonics(shuffled).map(n => n.id)).toEqual(expected);
    }
  });

  it('lists the partials of a plucked string, unison first', () => {
    // 2f0, 3f0, 4f0, 5f0, 6f0 rounded to semitones, plus unison at 0. Every
    // one of the six was re-measured after the discriminator changed and none
    // was removed; `HARMONIC_SEMITONES` carries the table.
    expect(HARMONIC_SEMITONES).toEqual([0, 12, 19, 24, 28, 31]);
  });
});
