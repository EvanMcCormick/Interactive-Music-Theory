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

## The pipeline is closed

Framing and the batch loop now sit between the model and the decoder, so the
server takes audio and returns `DetectedNote[]` — the same contract the client's
`NoteDetector` has.

The two trims are the whole difficulty and both are inherited exactly. Per
window, the 172 frames of output are cut to the middle 142, which is
`unwrapOutput`, and which is what the lead-in silence exists to make symmetric
at the first window. At the tail, the concatenated output overshoots the file
and has to be cut to `floor(len × 86/22050)` — **86**, the floored frame rate,
not the true 86.13, because that is what the library counts with and
disagreeing shifts everything in time. And `framesSoFar` advances by the
window's *untrimmed* 142 even when fewer rows were kept, which reads like a bug
and is what stops the loop chasing a quota it can never fill.

**Held against the library's own end-to-end path**, not against the client's.
`BasicPitch.evaluateModel` frames with `prepareData` — the function the client
replaces — so the reference checks the C# framing against the definition it was
ported from rather than against the port's sibling. Six seconds of synthesised
sawtooths at E2 A2 C3 E3 G3 B3: both find the same seven notes, at the same
pitches, within a frame. Six are the played fundamentals and the seventh is a
G2 sounding under the G3 at the same instant, which is the octave error
`suppressHarmonics` exists for.

Asserted musically rather than exactly, and deliberately: the two runtimes
agree on the model to 4.5e-7, but a detection sitting on the 0.3 threshold can
still fall either side of it, which is the thing the design already knew from
watching 86 same-attack pairs come back as 89.

## The design's job argument no longer rests on detection

**1.81 s** for a 4:22 stem, end to end on CPU — 145x realtime.

The design chose a job with a SignalR progress channel over a blocking request
on the basis that "detection plus note-building is around 15 s today and 25 s
with separation". Note-building is 147 ms and detection is the rest, so the 15 s
figure was the browser's, and the server is an order of magnitude under it.

The job is still the right shape, for reasons that survive: separation is 9.3 s
when it is licensed, a job survives a dropped connection, and the result being
stored rather than streamed is what answers a user navigating away. But
detection alone would not have required one, and a decision resting on a
measurement that has moved should say so.

## Wired

`POST /api/transcriptions` → `{ jobId }`, progress on `/hubs/transcription`,
`GET /api/transcriptions/{id}` for the result. The contract the design
specified, built as specified.

Four things worth recording because they are decisions rather than
transcription:

- **The job survived its own argument.** Detection is 1.81 s, not the 15 s the
  design assumed when it chose a job over a blocking request. Built as designed
  anyway: separation is 9.3 s when licensed, a job survives a dropped
  connection, and a stored result answers a user who navigates away. The
  weakened premise did not carry the conclusion by itself.
- **The database is the record and SignalR is a courtesy.** Every state change
  is written before it is broadcast, and `RemoteDetector` polls whether or not
  the hub connected. A blocked WebSocket costs a progress bar, not a
  transcription — and that is the path the client's tests exercise, because it
  is the one a user behind a proxy actually gets.
- **`NoteDetector.detect` gained an optional `file`.** The interface was
  deliberately not "give me a file" and still is not: the parameter is optional,
  so every test that hands a detector synthesised audio is unchanged. It exists
  because uploading decoded samples costs 2.3x the bytes, and because
  content-addressing only dedups across users if the hash is of something every
  user has identically — which a browser's decode output is not.
- **The SignalR client is loaded dynamically.** Importing it from `main.ts` put
  58 kB into the eager bundle for a route that is not the landing page:
  840.53 kB against 782.27. Reaching `RemoteDetector` through an `import()` puts
  it back to **784.74 kB**, which is the 2.5 kB the tiering itself costs.

## Not done

- **The real stem.** Everything is verified against synthesised audio or
  against the other tier. `client/src/assets/real-capture/johnny-bass.mp3` is
  gitignored and absent, so the acceptance criterion — the same derived
  `ScoreDoc` from both tiers on a real file — is still unrun, and NLayer's MP3
  decoding is still unexercised.
- **Sessions and audio storage.** The design's schema has three stores and this
  is one: detections, shared and content-addressed. Sessions are per-user
  interpretation and the client does not persist them yet; audio is opt-in,
  expiring, and needs a Blob lifecycle rule. Neither is needed by the detector
  contract.
- **The queue is in memory.** A restart loses whatever was queued, and those
  jobs stay `Queued` forever. Survivable at one process and under two seconds a
  job; the first thing to replace when there is a second server, and behind an
  interface so that replacement touches one registration.
- **Nothing has run against a real database.** The migration is generated and
  the tests use the in-memory provider. Docker was not running on this machine.
