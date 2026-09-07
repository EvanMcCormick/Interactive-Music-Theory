# The C# Decoder Port

**Date:** 2026-09-07
**Status:** Done and measured. First implemented piece of the two-tier design.

`outputToNotesPoly` now exists in .NET, and `Microsoft.ML.OnnxRuntime` is
referenced and proven to load. That is the server half of
`docs/plans/2026-09-07-two-tier-transcription-design.md`'s tier line, minus
inference, which needs the model in a format .NET can read.

---

## What was measured

Both runtimes, the same generated posteriorgram, stem-sized: 22,616 frames at
88 pitches, which is a 4:22 stem at 22.05 kHz on a 256-sample hop, planted at
the density that decodes to roughly the 1,224 detections
`real-detections.fixture.ts` holds.

| | `outputToNotesPoly` | notes |
|---|---|---|
| TypeScript, Node 22 | **17,508 ms** | 1143 |
| C#, faithful port | 1,782 ms | 1143 |
| C#, with the row-max cache | **147 ms** | 1143 |

119x end to end. The same 1,143 notes at every step, bit for bit.

## The design predicted this wrong, in a useful direction

The design put the quadratic loop out of scope for the server, on the reasoning
that "porting it to C# makes it fast enough that the algorithmic fix stops
mattering server-side". The first row above is the port with nothing else
changed, and 1.8 s is not fast enough — it is a second and three quarters of a
web request, and it would have been the largest single cost in the pipeline.

**Nine tenths of the win was the algorithm, not the language.** Native code
bought 9.8x; the cache bought another 12x on top. That reverses the priority
the design assigned: the fix is not a nice-to-have for the anonymous path, it
is where the time actually is, and the browser is paying all of it.

The fix is thirty lines and it transfers directly. The melodia loop finds the
largest remaining cell, erases a band around the note it grows, and repeats —
so every row it does not touch still holds the maximum it held last iteration.
The original recomputes all of them anyway, twice: once for `globalMax` in the
loop guard and once for the `reduce` that finds the coordinate. On this input
that is two million cells scanned twice, eleven hundred times over.
`RowMaxIndex` keeps a column of per-row maxima and refreshes only the rows the
erase touched.

**Done, same day.** `client/src/app/services/detection-melodia.ts` carries the
fix into the browser: **17,422 ms to 234 ms, 74x**, for the same 1,094 notes —
same order, same frames, same amplitudes to the last bit.

It turned out not to need a fork, which the 98.6 % figure is what made visible.
`remainingEnergy` is private to `outputToNotesPoly`, but it is exactly
reconstructible from the notes the onset pass returns: it starts as a copy of
`frames`, and the only writes before the melodia loop are the band each
*accepted* note clears across its own span — a note rejected for being too short
clears nothing, and every note that clears something is returned. So the module
calls the library with `melodiaTrick: false` for the 239 ms that is not the
problem, rebuilds the matrix from what came back, and reruns only the loop.
`detection-melodia.spec.ts` holds it against the library's own
`outputToNotesPoly` note for note across six generated cases, because that
reconstruction argument is a reading of a file this repository does not own.

## What the port is held to

Bit-exact agreement with the TypeScript on identical input, across six
generated cases from silent to saturated: same notes, same order, same
amplitudes, same bends, same times. Not approximate — `Assert.True(a.Equals(b))`
on the doubles.

`client/tools/basic-pitch-vectors.cjs` generates the input from a seed and runs
the real library over it; the C# side regenerates the same input and compares
against the frozen answers. What makes that trustworthy rather than circular is
that the generator is built from a uint32 PRNG and arithmetic IEEE 754 pins
exactly — no `exp`, no `log`, no `pow` — and each case carries an FNV hash of
its matrices that the C# side asserts *before* it compares a note. A generator
that has drifted fails as a generator, not as a phantom port bug.

Committing real posteriorgrams instead would be about a hundred megabytes for
one stem, and would still only exercise the branches one bass line reaches.

### This is not the acceptance criterion

The design's criterion is an identical derived `ScoreDoc` from a real file, and
nothing here reaches it: it needs inference on both sides. What this buys is the
ability to tell two failures apart. When the end-to-end comparison eventually
disagrees about a note, a green differential suite says the decoder is not at
fault and the argument moves to whether the score changed — which is the
question that matters. Without it, every end-to-end difference is a suspect
port.

## One measured difference between the runtimes

`Math.Pow` disagrees with V8's by an ulp. MIDI 40 is 82.406889228217494 Hz in
.NET and 82.40688922821748 in the browser, which carries into a contour bin of
57.000000000000007 against an exact 57. `Math.Log2` was the suspect and is not.

It cannot reach a bend, and the reason is structural. The contour grid is three
bins to a semitone above A0, so the bin for MIDI *p* is the exact integer
3*p* − 63, and the library rounds. The drift is ~1e-14 against a 0.5 threshold —
thirteen orders of magnitude of headroom, asserted across the whole 88-key range
rather than argued, because the argument depends on constants that a future
model could change.

## The model, and why no conversion was run

**Spotify already ships one.** `nmp.onnx` in the Python distribution is their
own export — its producer string is literally `tf2onnx` — alongside CoreML and
TFLite. 225 kB, Apache-2.0, and the licence carries no carve-out for the
weights, which is exactly the sentence Spleeter's README dropped. Running
tf2onnx here would have been reproducing the maintainer's work and owning the
result.

That it is theirs is reassuring and is not evidence. It is a different
serialisation run by a different runtime, and the two tiers have to agree about
notes. So it is measured, on one window of audio through both:

| output | max abs difference |
|---|---|
| frames | 3.576e-07 |
| onsets | 4.470e-07 |
| contours | 3.576e-07 |

Float32 rounding, against decoder thresholds of 0.3 and 0.5 — six thousand
times larger than the disagreement.

**The result that mattered more was the wrong pairing.** Frames and onsets are
both `[172, 88]` and the ONNX names — `StatefulPartitionedCall:1` and `:2` —
say nothing about which is which. A swap would run perfectly and transcribe
nonsense, every note starting where the previous one was still sounding. Cross-
comparing every pairing settled it by measurement: **0.745** for the wrong one
against 4.5e-7 for the right one. `Frames_and_onsets_are_not_interchangeable`
asserts that gap stays large, so the test cannot quietly stop being able to
tell the two apart.

The reference is frozen by `client/tools/basic-pitch-reference.cjs`, so the
check runs with no Node, no TF.js and no browser — the property
`real-detections.fixture.ts` has, for the same reason. The input is two
sawtooths a fifth apart rather than noise: exact in double arithmetic, so both
sides regenerate identical samples without the repository carrying them, and
harmonically rich enough that the outputs are strongly activated rather than a
field of near-zeros where any two implementations agree trivially.

## Not done

The two ends exist and the middle does not. `BasicPitchModel.Run` takes one
43,844-sample window; `OutputToNotesPoly` takes whole-file posteriorgrams.
Between them sit four things the client already has and the server does not:

- **Framing.** `detection-framing.ts`, which exists because the library's own
  `prepareData` crashes the WebGL shader compiler on a sixteenth of song-length
  inputs. None of that applies server-side, but the windows have to come out
  identical or the tiers disagree about where every note is.
- **The batch loop, the overlap trim (`unwrapOutput`), and the trim to the
  frame count the audio implies.** `basic-pitch-detector.ts` carries all three
  and warns that the last is the subtle one.
- **Wiring.** No controller, no job, no SignalR, no `RemoteDetector`.
  Deliberate: worth knowing the arithmetic is right before there is a wire
  protocol arguing about it.
- **An audio decoder.** Still the open question the design named. NAudio covers
  MP3 and WAV; anything wider is FFmpeg and its licensing.

Only the first two are needed for the acceptance criterion. With them, a real
file can go through both tiers and the derived `ScoreDoc`s compared — which is
the test the design says is the only one a user can perceive.
