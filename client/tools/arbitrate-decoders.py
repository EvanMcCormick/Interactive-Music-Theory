"""
Third decoder as tie-breaker: which of Chrome and NLayer loses a frame at 140 s.

`docs/plans/2026-09-07-decoder-alignment.md` measured the two tiers' decodes of
the same MP3 sitting two model frames apart for the first 140 seconds and
together for the rest. Two decoders that disagree are two opinions. This runs a
third - ffmpeg, which is what Chrome's own decoder is built on but invoked
independently and without the browser's resampling and gapless conventions - and
asks which of the two it tracks across the file.

Whichever it agrees with throughout is the one behaving; the other is dropping
or inserting a frame at 140 seconds, and that decides whether the fix belongs in
`AudioDecoder` or whether the browser tier is the one carrying the defect.

    cd client
    npx ng test --configuration=envelope --watch=false > browser-env.log
    cd ../server && ENVELOPE_DUMP=../client/server-env.json \\
        dotnet test --filter FullyQualifiedName~decode_envelope
    cd ../client && python tools/arbitrate-decoders.py

Everything it needs is the two envelopes those produce plus the stem itself.
Nothing here is committed output; it prints and exits.
"""

import json
import pathlib
import re
import shutil
import struct
import subprocess
import sys

SAMPLE_RATE = 22050
BUCKET = 256  # one model frame
STEM = pathlib.Path("src/assets/real-capture/johnny-bass.mp3")
BROWSER_LOG = pathlib.Path("browser-env.log")
SERVER_JSON = pathlib.Path("server-env.json")


def find_ffmpeg() -> str:
    """ffmpeg, wherever winget put it."""
    found = shutil.which("ffmpeg")
    if found:
        return found

    for pattern in (
        "C:/Users/*/AppData/Local/Microsoft/WinGet/Packages/*/ffmpeg*/bin/ffmpeg.exe",
        "C:/Users/*/AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe",
        "C:/ffmpeg/bin/ffmpeg.exe",
        "C:/Program Files/ffmpeg/bin/ffmpeg.exe",
    ):
        matches = list(pathlib.Path("/").glob(pattern.lstrip("/")))
        if matches:
            return str(matches[0])

    sys.exit("ffmpeg not found. Install it, or put it on PATH.")


def decode_with_ffmpeg(ffmpeg: str) -> list[float]:
    """
    Mono float32 at the detection rate, straight from ffmpeg.

    `-ar` and `-ac` make ffmpeg do the resample and the downmix, which is the
    same order the browser does them in and the opposite of the server's. Both
    are linear, so the order does not change the result beyond floating point -
    and this measurement is about *alignment*, which neither order moves.
    """
    raw = subprocess.run(
        [ffmpeg, "-v", "error", "-i", str(STEM),
         "-ar", str(SAMPLE_RATE), "-ac", "1", "-f", "f32le", "-"],
        capture_output=True,
        check=True,
    ).stdout

    return list(struct.unpack(f"<{len(raw) // 4}f", raw))


def envelope(samples) -> list[float]:
    out = []
    for at in range(0, len(samples) - BUCKET + 1, BUCKET):
        total = 0.0
        for i in range(at, at + BUCKET):
            total += samples[i] * samples[i]
        out.append((total / BUCKET) ** 0.5)
    return out


def read_browser_envelope() -> list[float]:
    text = re.sub(r"\x1b\[[0-9;]*m", "", BROWSER_LOG.read_text(encoding="utf-8", errors="ignore"))
    chunks = {int(m.group(1)): json.loads(m.group(2)) for m in re.finditer(r"ENV (\d+) (\[.*?\])", text)}
    out: list[float] = []
    for at in sorted(chunks):
        out.extend(chunks[at])
    return out


def correlation(a, b, lag, lo, hi) -> float:
    xs, ys = [], []
    for i in range(lo, hi):
        j = i + lag
        if 0 <= j < len(b) and i < len(a):
            xs.append(a[i])
            ys.append(b[j])
    n = len(xs)
    if n < 20:
        return -1.0
    mx, my = sum(xs) / n, sum(ys) / n
    num = sum((p - mx) * (q - my) for p, q in zip(xs, ys))
    dx = sum((p - mx) ** 2 for p in xs) ** 0.5
    dy = sum((q - my) ** 2 for q in ys) ** 0.5
    return num / (dx * dy) if dx and dy else -1.0


def best_lag(a, b, lo, hi) -> tuple[int, float]:
    lag = max(range(-6, 7), key=lambda l: correlation(a, b, l, lo, hi))
    return lag, correlation(a, b, lag, lo, hi)


def main() -> None:
    for needed in (STEM, BROWSER_LOG, SERVER_JSON):
        if not needed.exists():
            sys.exit(f"missing {needed}; see this file's docstring")

    ffmpeg = find_ffmpeg()
    print(f"ffmpeg: {ffmpeg}")

    reference = envelope(decode_with_ffmpeg(ffmpeg))
    browser = read_browser_envelope()
    server = json.load(SERVER_JSON.open())["envelope"]

    print(f"buckets: ffmpeg {len(reference)}, browser {len(browser)}, server {len(server)}")
    print("\n(1 bucket = 1 model frame = 11.61 ms; lag is how far that decoder sits *after* ffmpeg)\n")
    print(f"{'window':>12}  {'browser':>18}  {'server':>18}")

    window = int(20 * SAMPLE_RATE / BUCKET)
    verdict = {"browser": 0, "server": 0}

    for k in range(len(reference) // window):
        lo, hi = k * window + 5, (k + 1) * window
        bl, br = best_lag(reference, browser, lo, hi)
        sl, sr = best_lag(reference, server, lo, hi)

        print(f"{k * 20:5d}-{(k + 1) * 20:3d}s  {bl:+3d} frames r={br:.4f}  {sl:+3d} frames r={sr:.4f}")

        if bl == 0:
            verdict["browser"] += 1
        if sl == 0:
            verdict["server"] += 1

    total = len(reference) // window
    print(f"\nwindows aligned with ffmpeg: browser {verdict['browser']}/{total}, "
          f"server {verdict['server']}/{total}")
    print("\nThe one that tracks ffmpeg throughout is behaving. The one whose lag")
    print("changes partway through is the one that loses a frame at 140 s.")


if __name__ == "__main__":
    main()
