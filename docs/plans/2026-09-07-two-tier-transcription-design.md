# Two-Tier Transcription Design

**Date:** 2026-09-07
**Status:** Design agreed, not yet implemented

Transcription becomes a feature of the education platform rather than a separate product. An anonymous visitor transcribes a stem in their browser and cannot save; a signed-in teacher or student gets persistence, server-side detection, and — when the licence clears — full-song input.

---

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Audience | Teachers and students already on the platform | No separate funnel, no separate auth. The existing JWT and Identity carry it, and the pay service is seat pricing rather than a second product |
| Tier line | Anonymous in-browser (no save) vs authenticated seat (everything) | One line, easy to explain. Compute is negligible at this scale, so there is little reason to meter further |
| Persistence | Transcription always; audio opt-in per user | The session is kilobytes of derived data; the recording is ten megabytes of someone else's copyright |
| Separation | Server-only, gated on the Spleeter licence | Running weights is a far weaker permission than redistributing them |

The free tier is not a free *plan* served at cost — it is a try-before-you-buy that costs nothing to run and carries no legal exposure, because nothing leaves the visitor's machine.

---

## 1. The split

The tier boundary falls on the fact/interpretation line M1 established, which makes the change small.

```
decode                    client (Web Audio)
detection                 SERVER for a seat, Web Worker for anonymous
outputToNotesPoly         SERVER — ported; see the note below the block
separation                SERVER only, when licensed
──────────────────────────────────────────────────────────
harmonic suppression      client — milliseconds
beat tracking             client — milliseconds
deriveScore + review UI   CLIENT ALWAYS — 0.10 ms per knob turn
```

Everything below the line stays put in both tiers. That block is the entire review screen: every control re-derives synchronously, and round-tripping it would destroy the property the design is built on.

**`outputToNotesPoly` stays above the line, but not for the reason given.** It was placed there as "the 10 s". It is now 234 ms in the browser and 147 ms on the server, so that argument is gone — and the placement is unchanged anyway, because the decoder has to run wherever the posteriorgram is. A four-minute stem's three output matrices are 22,616 frames by 88, 88 and 264 columns; sending them to the client to decode would be the largest thing that ever crossed the wire, several times the audio that produced them. What this does change is what a seat is buying: **inference, and separation once licensed.** Note-building is no longer part of the pitch.

**The free tier is not a degraded product. It is the same product with a different `NoteDetector`.**

`RemoteDetector implements NoteDetector`, selected by the existing `NOTE_DETECTOR` injection token reading auth state — `WorkerDetector` when anonymous, `RemoteDetector` when signed in. Nothing else in the chain knows which is running. `note-detector.ts`'s own docblock anticipated this before it was asked for:

> …what leaves room for a server-side detector later: a bigger model, or one that will not fit in a bundle, becomes an implementation of `detect` that happens to POST the samples somewhere.

Two consequences worth naming. Every browser-specific failure this codebase has hit — the TF.js async-readback hang, the concat shader bug at certain file lengths, the WebGL fallback — exists **only in the anonymous path**, which is where a failure costs least. And the paid path runs `Microsoft.ML.OnnxRuntime`, where none of them exist.

---

## 2. What crosses the wire

**Upload the original file, not decoded samples.** The decoded form is larger: a 4:22 stem is 10 MB as MP3 and **23 MB** as mono Float32 at 22.05 kHz.

This means the backend needs an audio decoder, and it is a dependency to choose deliberately. NAudio covers MP3 and WAV; wider format support (M4A, FLAC, OGG) means FFmpeg, with its licensing and deployment weight.

```
POST /api/transcriptions        → { jobId }
SignalR: transcription/{jobId}  → progress
GET  /api/transcriptions/{id}   → { notes, bendFrameRateHz, durationSec }
```

The response is `DetectionResult` plus the duration and nothing else. Suppression, beat tracking and derivation stay client-side, so the server never learns about tunings, capos or metrical levels.

**A job rather than a blocking request.** Detection plus note-building is around 15 s today and 25 s with separation. A job survives a dropped connection, and the platform's cost model already assumes SignalR for lesson synchronisation, so the progress channel is infrastructure already paid for.

**Content-address the uploads.** Hash the file; if those bytes have been transcribed before, return the existing detections. A teacher assigns one riff to thirty students and that is **one** inference run, not thirty. Assignment-driven usage is naturally repetitive, which is the best possible shape for a cache — and the same hash dedups a student re-uploading last week's track.

---

## 3. Persistence

Three stores, deliberately different lifetimes:

| | contents | where | lifetime |
|---|---|---|---|
| **detections** | `rawNotes`, `bendFrameRateHz`, `durationSec`, keyed by content hash | SQL, compressed | indefinite, **shared** |
| **session** | `grid`, `trackedGrid`, `settings`, `harmonics`, `decisions`, `monophonic`, `beatsPerPulse` | SQL, per user | indefinite |
| **audio** | the uploaded file | Blob | **opt-in, expiring** |

**M1's two-layer model becomes the schema.** Detections are facts and are shared; everything else is interpretation and is per user. Thirty students assigned one riff means one detection row and thirty session rows, each adjusting tuning, capo and metrical level without touching anyone else's. The content hash does double duty — it dedups the compute and it is the foreign key.

`rawNotes` is the bulk (1224 detections on a four-minute stem, `bendCents` dominating at roughly 30 values per note). Compressed it is small, and it is the one thing that must persist, because it is what makes re-derivation possible tomorrow without re-uploading.

**Audio is a separate row with a separate lifetime**, which is what keeps the compliance burden tractable: default off, explicit opt-in, a Blob lifecycle rule expiring it on a timer, and deletion that does not touch the transcription. *"Delete my recordings, keep my tabs"* becomes one operation rather than a migration. GDPR export is the session JSON plus whatever audio is still live.

Anonymous persists nothing — but that is not data loss, since the composer's existing library already saves scores. What anonymous loses is the ability to re-derive later.

---

## 4. Separation

Server-only, permanently — not because the browser cannot (9.3 s for a four-minute track, measured, no GPU) but because **running** weights is a much weaker permission than **redistributing** them, and redistribution is precisely what Deezer's unanswered issue #957 concerns. Server-side, nothing is shipped.

A request flag rather than a new endpoint — `POST /api/transcriptions { separate: true }` — running ahead of detection when the input is a full mix. Until the licence clears it stays off and nothing else changes.

**Design in now, not later: the session records that it came from separation.** Measured, separation costs 18 points of F1 and *all of it is precision* — recall rises 68.8 → 74.7 %. So separated input wants a different default `confidenceFloor` than a clean stem, with 5.9 points of recall headroom to spend buying precision back. A field now; an awkward migration later.

See `docs/plans/2026-09-07-stem-separation-feasibility.md` for the licensing analysis and the measurements.

---

## 5. Failure handling

**A server outage degrades rather than breaks.** Because both detectors implement one interface, `RemoteDetector` failing falls back to `WorkerDetector`: a paying user gets an in-browser transcription instead of an error page. They lose separation and speed, not the product. This is nearly free and should not be skipped.

The rest is unremarkable and should stay so:

- oversized or unsupported uploads rejected client-side before the bytes move
- a server decode failure returns the shape the client already handles from `decodeAudioData`
- jobs owned by user id, so an expired token resumes rather than orphans

The one genuinely new failure is a job completing after the user has navigated away, which the persistence model already answers — the result is stored, not streamed.

---

## 6. Testing

Most of it already exists. M2 built the suite against a stub `NoteDetector`, so `RemoteDetector` drops into the same tests unchanged; 847 tests do not care which detector runs. What is new is small and ordinary: the HTTP contract, job progress, the fallback path, persistence round-trip, hash dedup.

**The test that matters is equivalence between the two detectors**, and the apparatus exists: `real-detections.fixture.ts` holds 1224 frozen detections from the browser path on a real file.

It will not reproduce them exactly, and the design says so rather than discovering it: TF.js is not bit-reproducible between runs near the 0.3 frame threshold — already measured, when a fixture's 86 same-attack pairs came back as 89 from a live session. Bit-equality is the wrong assertion. Musical equivalence is the right one, at three levels:

1. every played pitch found by one is found by the other, within one frame
2. detection counts agree within a small tolerance
3. **the derived `ScoreDoc` is identical**

The third is the acceptance criterion — the only level a user can perceive. If two runtimes disagree about a detection at confidence 0.301 and the score is unchanged, nothing happened.

**The accuracy harness transfers for free.** It runs on frozen detections and is already implementation-agnostic: capture from .NET and the same floors must hold — P 61.5 / R 70.3 / F1 65.6, 3 destroyed. A C# port that quietly changed note-building would fail there rather than in production.

Untestable cheaply, and honestly so: SignalR under load, Blob lifecycle, real concurrency. Integration and staging.

---

## Deliberately not in scope

- **Metering and quotas.** Compute is $0.49 per thousand tracks for separation and less for detection. At the platform's projected scale there is nothing worth metering yet.
- **A premium tier above a seat.** One line, deliberately. Splitting it later is easy; unsplitting it is not.
- **Desktop or Electron.** Nothing measured requires leaving the browser, and the anonymous tier's zero-install trial is the strongest funnel the product has.
- ~~**`outputToNotesPoly`'s quadratic loop.** Porting it to C# makes it fast enough that the algorithmic fix stops mattering server-side — but the anonymous path still pays 10 s, so the fix is still worth doing on its own.~~ **Measured, wrong, and now done in both tiers.** The port alone lands at 1.8 s, which is not fast enough for a request path; the algorithmic fix takes it to 147 ms. Native code bought 9.8x and the fix bought another 12x on top, so nine tenths of the win was the algorithm rather than the language — and 98.6 % of the cost is one loop, which is what made it liftable in the browser too without forking the decoder. The anonymous path now pays **234 ms rather than 10 s**. See `docs/plans/2026-09-07-csharp-decoder-port.md`.

## Open questions this design does not settle

- **Deezer's answer on the Spleeter weights.** Gates separation entirely. The cheapest and highest-value action available.
- **Which audio decoder** the backend uses, and whether FFmpeg's weight is worth format coverage beyond MP3 and WAV.
- **What a seat costs**, and whether transcription changes it. A pricing question, not an architectural one.
