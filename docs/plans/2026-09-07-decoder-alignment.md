# The Tiers Disagree Because the Decoders Are Misaligned

**Date:** 2026-09-07
**Status:** Root cause found. **Not yet fixed.** Hysteresis was the wrong fix and is not being built.

The brief was to add hysteresis to harmonic suppression, on the reasoning from
`2026-09-07-two-tier-equivalence.md` that it amplified 5 differing detections
into 18 differing decisions. Measuring first said the premise was wrong twice
over, and the second measurement found something better.

---

## Hysteresis cannot work here, and the numbers say so before any is written

Every deadband, hysteresis rule or quantisation is the same bet: that the
perturbation is smaller than the band you widen. So the perturbation was measured
first.

Matching notes across the two tiers on pitch and onset, the confidence of the
*same note* moves by:

| mean | median | p90 | p99 | max |
|---|---|---|---|---|
| 0.0072 | 0.0035 | 0.0155 | 0.0767 | 0.2355 |

And the pairs the partial rule judges sit this close to their threshold:

| within | 0.001 | 0.005 | 0.01 | 0.02 | 0.05 |
|---|---|---|---|---|---|
| pairs (of 402) | 3 | 16 | 34 | 61 | 133 |

**A band wide enough to absorb a p90 perturbation of 0.0155 would swallow about
50 of the 402 decisions** — an eighth of them — and would still leave the p99 to
flip. A band narrow enough not to change the calibration absorbs almost nothing:
only 3 pairs sit within 0.001. There is no width that both helps and is safe.

The 3.6x amplification is real. Hysteresis is not the lever that moves it.

## The actual cause: the decoders are 23 ms apart for half the file

Notes that match across the tiers are not scattered around zero offset. They are
**bimodal**:

```
offset in whole frames: -4:1  -3:6  -2:5  -1:45  +0:527  +1:15  +2:482  +3:79  +4:4
```

527 notes exactly together, 482 exactly two frames apart, and almost nothing in
between. Split by position in the file, the two populations are not interleaved
at all — they are consecutive:

| | mean offset |
|---|---|
| 0-131 s | **+2.0 frames** |
| 131-158 s | +0.33 (the transition) |
| 158-263 s | **0.0 frames** |

Notes are a lossy instrument for this, so it was confirmed on the audio.
Cross-correlating an RMS envelope of the two decodes, one bucket per model
frame:

| | best lag | r at that lag | r at lag 0 |
|---|---|---|---|
| 0-140 s | **+2 frames** | 0.95-0.99 | 0.79-0.88 |
| 140-260 s | **0 frames** | 0.99 | 0.99 |

**A clean step at about 140 seconds.** Not drift, not noise, not a threshold.
The server's decode runs 23.2 ms late for the first 140 seconds of the recording
and then, at one point, catches up.

## Where 512 samples went

The file is LAME 3.100 with an `Info` header, so it declares gapless metadata:
10,053 MPEG frames, 11,581,056 samples at 44.1 kHz. What each decoder returns,
at 22.05 kHz:

| | samples | x2 (44.1 kHz) | short of the declared length |
|---|---|---|---|
| browser | 5,789,696 | 11,579,392 | 1,664 |
| server | 5,789,952 | 11,579,904 | **1,152 — exactly one MPEG frame** |

One MPEG frame is 1,152 samples at 44.1 kHz, which is 576 at 22.05 kHz, which is
2.25 model frames — the size of the offset that was measured. Both ends of the
finding agree.

So the two defects are:

1. **The encoder delay is not being stripped.** Chrome honours the LAME header
   and discards the priming samples; NLayer does not, so everything it returns
   starts about one MPEG frame late.
2. **One MPEG frame goes missing at around 140 seconds**, which is what removes
   the offset for the rest of the file. A decoder that silently drops a frame
   mid-stream is the more serious of the two, because nothing else would ever
   notice.

## What this explains

Both halves of the equivalence result, without needing anything else:

- **The beat grid.** 438 tracked beats against 436. A 23 ms shift applied to
  half a performance and then removed is exactly the kind of thing that moves a
  pulse estimate, and the grid is what displaced every bar after it.
- **The suppression decisions.** Onsets shifted by two frames change which notes
  overlap, which changes which pairs the harmonic rule judges at all — 402 pairs
  on one side against 395 on the other. That is a bigger effect than any
  confidence moving across a threshold.

It also means the ONNX port, the framing, the trims and the decoder's resampler
are not implicated. The model agrees to 4.5e-7 and the decoder port is bit-exact
given the same posteriorgrams. What is wrong is 512 samples of alignment.

## What to do

**Fix the alignment; do not touch suppression.** In order:

1. **Strip the encoder delay in `AudioDecoder`.** Read the `Xing`/`Info` and
   `LAME` headers, discard the declared priming samples and trim the declared
   padding. This is the fix Chrome already applies and it is what makes the two
   tiers start at the same sample.
2. **Find the dropped frame at ~140 s.** Whether it is NLayer, the
   `Mp3FileReaderBase` wrapper, or the short-read handling in
   `BandLimitedResampler.Read`, a decoder that loses a frame without erroring is
   a defect on its own terms, independent of the two-tier comparison.
3. **Re-run the equivalence measurement.** The 27.5 % bar agreement is a number
   taken with a known misalignment in it, and it should not be quoted as the
   cost of running two tiers until that is out.

**Do not add hysteresis.** It was a reasonable idea from the symptom and it
addresses a mechanism that turns out not to be the dominant one. If suppression
still amplifies once the decoders line up, the numbers at the top of this
document are what to re-measure against — and the p90 of 0.0155 says a deadband
is the wrong tool even then.

## Apparatus

- `client/src/app/services/harmonic-eval/suppression-sensitivity.spec.ts` — the
  margin distribution, the perturbation size, and the bimodal offset.
- `client/src/app/services/harmonic-eval/decode-envelope.spec.ts` and
  `RealCaptureTests.The_decode_envelope_is_written_for_comparison` — the two
  halves of the envelope comparison. Both need the user's file.
