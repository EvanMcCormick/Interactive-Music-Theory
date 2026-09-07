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

**Recommended:** port `RowMaxIndex` back into `toMidi.ts`. The anonymous tier is
the one with no fallback, it is the tier a first-time visitor meets, and this is
a known-good change with a test suite already pointed at it.

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

## Not done

- **The model.** Basic Pitch ships as TF.js — a `model.json` and one weight
  shard. ONNX Runtime is referenced and loads, and has nothing to load. A
  `tf2onnx` conversion, verified output-against-output on the same audio, is the
  next step and the one that unblocks the real acceptance criterion.
- **The decoder is not wired to anything.** No controller, no job, no SignalR,
  no `RemoteDetector`. Deliberate: it is worth knowing the arithmetic is right
  before there is a wire protocol arguing about it.
- **An audio decoder.** Still the open question the design named. NAudio covers
  MP3 and WAV; anything wider is FFmpeg and its licensing.
