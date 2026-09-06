# The detection worker investigation

**What started it:** a user's stem came back with "The detection worker failed."
about a second in, with the progress bar still on zero. The message was the same
one every other worker failure produced, so the file was the obvious suspect.

It was two faults, neither of them about the file. Both are fixed on
`fix/detection-worker-stem`. A third finding is recorded here and deliberately
not fixed.

Nobody will re-derive `N % 16 === 1` from scratch, so the arithmetic is written
out in full below.

---

## Fault A — one message covered two very different failures

`worker-detector.ts` rejected with `event.message || 'The detection worker
failed.'`. `WorkerEventMap` types an `error` handler's argument as `ErrorEvent`,
which is only sometimes true.

Measured in Chrome:

| what happened | event dispatched | `event.message` |
|---|---|---|
| worker script URL 404s | plain `Event` (`instanceof ErrorEvent === false`) | absent |
| worker script throws | `ErrorEvent` | `Uncaught Error: boom from worker` |
| worker script is not JS | `ErrorEvent` | `Uncaught SyntaxError: ...` |

A script that fails to **fetch** dispatches a bare `Event` with no `message`,
`filename` or `lineno` at all — the failure happens before the worker has any
error handling of its own. Everything raised *inside* a live worker arrives as a
real `ErrorEvent` carrying text.

The user's report was the first row: the worker chunk had not downloaded. That
is file-independent, and the generic string sent everyone hunting the audio.

**Fixed** by telling them apart. A bare `Event` — or an `ErrorEvent` with an
empty message, which is how Firefox and Safari report the same thing — now says
the worker could not be loaded and says out loud that the audio is not at fault,
because "try another file" is advice that cannot work here. An `ErrorEvent` with
a message still reports it verbatim. `worker-detector.spec.ts` dispatches both
at a stubbed worker.

---

## Fault B — 6.25 % of song-length files crashed the shader compiler

### The mechanism

`BasicPitch.prepareData` calls
`tf.signal.frame(wavSamples, 43844, 36164, true, 0)`, which slices one tensor
per model window and hands the list to `tf.concat`. TF.js 3.21's WebGL concat
(`kernels/Concat_impl.ts`) chunks its inputs by
`maxTexturesInShader = Math.min(16, gl.MAX_TEXTURE_IMAGE_UNITS)` — 16 on any
WebGL2 device — and **recurses on the chunk results**.

When a chunk holds exactly one tensor, `concat_gpu.ts` generates a shader that
cannot compile:

```js
const offsets = new Array(shapes.length - 1);   // length 0 for one input
offsets[0] = shapes[0][1];                      // grows it to 1
const lastIndex = offsets.length;               // 1
snippets.push(`else setOutput(getT${lastIndex}(yR, yC-${lastShift}));`);
```

`variableNames` is `['T0']`, the GLSL calls `getT1`, and compilation fails with
`ERROR: 0:140: 'getT1' : no matching overloaded function found`, surfacing as
`Error: Failed to compile fragment shader.` `ConcatPackedProgram` has the same
defect. `tf.concat` itself escapes it only because the op clones a lone tensor
instead of running a kernel — the recursive call *inside* the backend does not.

### The exact rule

With `N = ceil((3840 + decodedSamples) / 36164)` windows at 22.05 kHz — 3840 is
the model's lead-in, 36164 its hop — framing fails iff

```
fails(N) = N > 16 && (N % 16 === 1 || fails(ceil(N / 16)))
```

The recursion is not decoration. It claims a run of **seventeen consecutive
counts, N = 257..273** (roughly 7:00 to 7:29 of audio), of which the fifteen in
the middle, 258..272, do not satisfy `N % 16 === 1` at all: 258 windows chunk
into 17 results, and 17 chunk into 16 + 1.

Measured:

| audio | windows | mod 16 | result |
|---|---|---|---|
| 209.7 s | 128 | 0 | OK |
| **209.8 s** | **129** | **1** | **FAIL in ~1 s** |
| 212.0 s | 130 | 2 | OK |
| 237.0 s | 145 | 1 | FAIL |
| 480.0 s | 293 | 5 | OK |

A 1.64 s dead band every 26.24 s — 6.25 % of durations, plus the 257..273 run.
Under ~26 s it cannot trigger, which is why every fixture in the repository
passed. It dies inside `prepareData` before any batch runs, so the progress bar
never moves, and MP3 encoder delay and padding make the decoded sample count
unpredictable from the nominal duration, so a user cannot anticipate it.

### The fix, and the one that was not taken

**Padding** the audio with silence until `N` lands on a safe count is the
smaller change and was rejected. Two reasons:

1. It leaves the fix depending on a library internal invisible from here. The
   chunk size is a GPU capability, and how TF.js chunks is not API.
2. The arithmetic is not the one-liner it looks like. Inside the 257..273 run a
   *single* hop of padding lands on another failing count; escaping it takes 17
   hops, 27.9 s of silence. Any padding implementation has to carry the
   recursive predicate above, which is more reasoning about the library's
   internals than not using them.

**`detection-framing.ts`** builds the windows directly instead: one
`Float32Array` allocation, one `set` per window, one `tf.tensor3d`. It depends
on nothing but the definition of `tf.signal.frame`, and it is cheaper on exactly
the files that used to break — N slice kernels and a log-depth tree of concats,
whose intermediates are about twice the framed data again in GPU textures,
become one upload.

### Evidence it changed nothing but when a shader compiles

- The framed tensor is **bit-identical** to `prepareData`'s at every window
  count `prepareData` can build. `detection-framing.spec.ts` asserts it
  elementwise at 1, 2, 3, 16 and 18 windows, against `prepareData`'s body
  written out as the reference.
- Real detection over 8.3 s of bassline returns the **same 33 notes** with
  identical pitches, onsets, offsets, confidences and bend arrays under either
  framing (digest `hash=1271273280` both ways).
- `framesWanted` is computed from `audio.length` as before. Nothing about the
  framing lengthens the audio, but the invariant is stated in the docblock: if
  anything ever does, that number must not move with it.
- The accuracy harness scores frozen detector output and is untouched.

### Running the proofs

`detection-framing.spec.ts` is in the default suite and covers the defect in a
second, at 17 windows — the smallest count that triggers it. The reported
failure end to end, at its reported length, is out of the default suite for the
same reason `harmonic-capture.spec.ts` is:

```
npm test -- --configuration=longform --watch=false
```

It reports `LONGFORM 209.8 s  129 windows  841 notes  65.1 s`.

---

## Recorded, not fixed — `outputToNotesPoly` is the next wall

Now the dominant cost of a long transcription, and superlinear:

| frames | audio | `outputToNotesPoly` |
|---|---|---|
| 17,974 | 208.7 s | 7.8 s |
| 25,800 | 299.6 s | 24.0 s |
| 41,268 | 479.1 s | **62.7 s** |

At eight minutes that is 62.7 s of a 78 s run — inference itself is the smaller
half. A log-log fit over those three points gives **n^2.5**; the pairwise
exponents are 3.11 and 2.05, so the growth is steeper than the `n^1.9` the first
pass recorded, and steeper still at the long end.

The cause is the melodia trick in `@spotify/basic-pitch/src/toMidi.ts`:

```js
while (globalMax(remainingEnergy) > inferredFrameThresh) {     // line 442
  const [iMid, freqIdx] = remainingEnergy.reduce(...);          // line 445
```

Two full scans of the `frames x 88` matrix per note extracted — `globalMax` to
test the loop condition, then `reduce` to find the argmax it just computed.
Notes grow with length, so the product grows faster than the matrix does.

Not a crash, and out of scope here, but a user transcribing a full song will
feel it. The obvious remedy is a single scan that returns the max and its
position together, which is a change to library code and so wants either a fork
or a reimplementation like the inference loop's.

---

## Files

- `client/src/app/services/worker-detector.ts` — Fault A
- `client/src/app/services/detection-framing.ts` — Fault B, with the full rule
  in its docblock
- `client/src/app/services/basic-pitch-detector.ts` — calls the framing
- `client/src/app/services/long-file-detection.spec.ts` — the reproduction,
  opt-in
- `client/angular.json` — the `longform` configuration
