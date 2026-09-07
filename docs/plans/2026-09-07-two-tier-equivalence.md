# Two-Tier Equivalence: The Measurement

**Date:** 2026-09-07
**Status:** Measured on the real stem. **The design's acceptance criterion is not met.**

The two-tier design named three levels of agreement between the browser and the
server, and called the third the acceptance criterion:

> 1. every played pitch found by one is found by the other, within one frame
> 2. detection counts agree within a small tolerance
> 3. **the derived `ScoreDoc` is identical**
>
> The third is the acceptance criterion — the only level a user can perceive.

Levels 1 and 2 pass comfortably. Level 3 fails, and not narrowly.

---

## What was measured

The same file through both tiers: `Johnny-Bass.mp3`, 10,505,448 bytes, a
320 kbps monophonic electric bass stem, 4:22.6.

| | samples | duration | detections |
|---|---|---|---|
| browser — Chrome, Web Audio, TF.js/WebGL | 5,789,696 | 262.5712 s | 1,224 |
| server — NAudio, ONNX Runtime, CPU | 5,789,952 | 262.5829 s | 1,219 |

256 samples apart, which is exactly one FFT hop. Five detections apart, which
is 0.41 %.

Both find the same pitch set — the server hears one extra pitch class, MIDI 53 —
and both bottom out at MIDI 27, the open E flat of a bass tuned a half step
down, which is what `real-detections.fixture.ts` records. Both track the same
pulse to within half a BPM.

**And then the scores diverge.**

| | bars written identically |
|---|---|
| each tier tracking its own grid | **27.5 %** (30 of 109) |
| both derived on the browser's grid | **63.3 %** (69 of 109) |

## The cause splits in half

**Half is beat tracking.** The server's detections lead `trackBeats` to 438
beats where the browser's lead it to 436. Two extra beats shift every bar after
them, and a bar-by-bar comparison counts one displaced grid as a hundred
failures. Holding the grid constant recovers 36 points, from 27.5 % to 63.3 %.

`trackBeats` runs **client-side in both tiers**. This is not a property of the
port, and no amount of making the port more faithful touches it.

**Half is harmonic suppression amplifying a small difference.** The tiers
disagree about 5 detections in 1,224. After suppression they disagree about 13
notes in ~930 — suppression removed 303 on one side and 285 on the other, an
18-decision difference out of a 5-detection difference. It decides on *ratios
between neighbouring notes*, so a confidence that moves in its last few percent
can flip the verdict on a note that did not itself change.

Neither cause is a defect in the C# port. The ONNX weights agree with TF.js to
4.5e-7; the decoder port produces the same notes as the library given the same
posteriorgrams, bit for bit. What the measurement exposes is that a pipeline
with threshold decisions in it does not have a stable output under a
perturbation of its input, however small.

## The uncomfortable implication

**The browser tier probably does not agree with itself either.**

The design already recorded that TF.js is not bit-reproducible between runs near
the 0.3 frame threshold — a fixture's 86 same-attack pairs came back as 89 from
a live session. That is a perturbation of the same order as the one between
tiers. If 5 detections of difference produce 18 suppression decisions and a
displaced beat grid, then re-running detection on the same file in the same
browser can be expected to do something similar.

That reframes the finding. It is not "the server disagrees with the browser".
It is **"this pipeline's output is not stable under small input perturbations,
and the two-tier comparison is the first thing that made it visible."**

**This is the measurement to run next**, and it is cheap: capture
`real-detections.fixture.ts` twice from the same browser on the same file and
derive both. If the browser-against-browser divergence is comparable to the
browser-against-server divergence, tier equivalence was never the problem and
the acceptance criterion was asking for something no single tier delivers
either.

## What to do about the criterion

Not settled here, deliberately — this is a measurement, and the choice below is
a product decision:

- **Weaken the criterion to what is achievable.** "The same pitches, the same
  pulse, and a score a musician would call the same performance" is defensible
  and is what the numbers support. "Identical" is not achievable across two
  decoders and should not have been written as though it were.
- **Reduce suppression's sensitivity.** The amplification factor — 3.6 decisions
  changed per detection changed — is the actionable number. Hysteresis, or a
  margin around the ratio thresholds, would cost precision on paper and buy
  stability that the accuracy fixtures currently cannot see, because they all
  run on one frozen capture.
- **Make the grid deterministic given approximately-equal notes.** Two extra
  beats in 438 should not be able to displace a whole score. Whatever in
  `trackBeats` decided those two beats is the highest-leverage single fix, since
  it accounts for half the divergence on its own.

## What is not in doubt

Everything below the tier line behaved exactly as designed. The port is faithful,
the model conversion is exact to float32 rounding, the framing and trims are
right, and the decoder disagreement is one FFT hop over four minutes. The
divergence is entirely downstream of the parts this milestone built, in code
that both tiers share.

Measured by `client/src/app/services/harmonic-eval/two-tier-equivalence.spec.ts`,
against `server-detections.fixture.ts` and `real-detections.fixture.ts`. Both
freezes are committed, so the comparison re-runs with no audio, no model and no
server.
