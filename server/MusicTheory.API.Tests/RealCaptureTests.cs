using System.Text.Json;
using MusicTheory.API.Services.Transcription;
using Xunit.Abstractions;

namespace MusicTheory.API.Tests;

/// <summary>
/// The server pipeline on the real recording, and the only place NLayer's MP3
/// decoding is exercised at all.
/// </summary>
/// <remarks>
/// <para>
/// The audio is the user's file, not the repository's — a 320 kbps monophonic
/// electric bass stem, 4:22.6 — and it is gitignored, so this skips when it is
/// absent rather than failing. That is the same bargain
/// <c>real-capture.spec.ts</c> makes on the client, and for the same reason:
/// the derived data is what gets committed, so the measurement can run
/// afterwards with no audio at all.
/// </para>
/// <para>
/// What it checks against is what the browser produced from the identical file.
/// <c>real-detections.fixture.ts</c> froze 5,789,696 samples, 262.5712 seconds
/// and 1,224 detections; every number here is that comparison. Nothing else in
/// either suite decodes a real MP3, so a decoder that were quietly wrong — a
/// frame dropped, a rate misread — would show up here first and nowhere else.
/// </para>
/// <para>
/// Run it with the file in place:
/// <c>dotnet test --filter Category=RealCapture</c>. Pass
/// <c>TRANSCRIPTION_DUMP=path.json</c> to write the detections out for the
/// client's side of the comparison.
/// </para>
/// </remarks>
[Trait("Category", "RealCapture")]
public class RealCaptureTests(ITestOutputHelper output)
{
    /// <summary>Where the client's own capture spec expects the file.</summary>
    private static readonly string AudioDirectory = Path.GetFullPath(
        Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..",
            "client", "src", "assets", "real-capture"));

    /// <summary>Samples <c>decodeToMono</c> produced in the browser.</summary>
    private const int BrowserSampleCount = 5789696;

    /// <summary>Length of the stem in seconds, as the browser's decoder reported it.</summary>
    private const double BrowserDurationSec = 262.5712;

    /// <summary>Detections the browser path found. See `real-detections.fixture.ts`.</summary>
    private const int BrowserDetectionCount = 1224;

    [SkippableFact]
    public void The_real_stem_decodes_and_transcribes()
    {
        var path = FindAudio();
        Skip.If(path is null, $"No stem in {AudioDirectory}; this measurement needs the user's file.");

        var fileInfo = new FileInfo(path!);
        output.WriteLine($"{fileInfo.Name}  {fileInfo.Length:N0} bytes");

        // The first real MP3 either decoder here has seen.
        using var file = File.OpenRead(path!);
        var decoded = AudioDecoder.DecodeToMono(file);

        output.WriteLine(
            $"decoded   {decoded.Audio.Length:N0} samples  {decoded.DurationSec:F4}s  "
            + $"from {decoded.SourceSampleRate} Hz x{decoded.SourceChannels}");
        output.WriteLine(
            $"browser   {BrowserSampleCount:N0} samples  {BrowserDurationSec:F4}s");

        // Two decoders, two resamplers. They will not agree to the sample, and
        // a disagreement of more than a frame would mean one of them is
        // dropping audio rather than rounding differently.
        var sampleDifference = Math.Abs(decoded.Audio.Length - BrowserSampleCount);
        output.WriteLine($"          {sampleDifference:N0} samples apart");

        Assert.True(
            sampleDifference < DetectionFraming.FftHop * 4,
            $"NAudio produced {decoded.Audio.Length:N0} samples against the browser's "
            + $"{BrowserSampleCount:N0} - {sampleDifference:N0} apart, which is more than "
            + "rounding. One of the two decoders is losing audio.");

        Assert.Equal(BrowserDurationSec, decoded.DurationSec, 1);

        using var detector = new BasicPitchDetector();
        var started = DateTime.UtcNow;
        var result = detector.Detect(decoded.Audio, DetectionFraming.DetectionSampleRate);
        var elapsed = DateTime.UtcNow - started;

        output.WriteLine(
            $"detected  {result.Notes.Count} notes in {elapsed.TotalSeconds:F2}s  "
            + $"({decoded.DurationSec / elapsed.TotalSeconds:F0}x realtime)");
        output.WriteLine($"browser   {BrowserDetectionCount} notes");

        var pitches = result.Notes.Select(n => n.Pitch).ToList();
        output.WriteLine($"pitch range {pitches.Min()}-{pitches.Max()}");

        // The stem is a bass tuned a half step down: the four open strings are
        // MIDI 27, 32, 37 and 42, and the fixture records that nothing below 27
        // is reported at all.
        Assert.True(pitches.Min() >= 27, $"lowest pitch {pitches.Min()} is below the open E flat");

        // Detection counts will not match exactly - different decoder, different
        // resampler, different inference runtime - but they are counting the
        // same performance, so a large gap means something structural.
        var ratio = (double)result.Notes.Count / BrowserDetectionCount;
        output.WriteLine($"ratio     {ratio:F3}");

        Assert.InRange(ratio, 0.8, 1.25);

        Dump(result, decoded.DurationSec);
    }

    private static string? FindAudio()
    {
        if (!Directory.Exists(AudioDirectory))
        {
            return null;
        }

        // The client spec names johnny-bass.mp3; the file on disk may be cased
        // differently, and this is not the place to be fussy about it.
        return Directory.EnumerateFiles(AudioDirectory, "*.mp3").FirstOrDefault()
               ?? Directory.EnumerateFiles(AudioDirectory, "*.wav").FirstOrDefault();
    }

    /// <summary>
    /// Writes the detections where the client can compare them, when asked.
    /// </summary>
    private void Dump(DetectionResult result, double durationSec)
    {
        var target = Environment.GetEnvironmentVariable("TRANSCRIPTION_DUMP");
        if (string.IsNullOrWhiteSpace(target))
        {
            return;
        }

        var payload = new
        {
            source = "server",
            sampleCount = 0,
            durationSec,
            bendFrameRateHz = result.BendFrameRateHz,
            notes = result.Notes.Select(n => new
            {
                n.Pitch,
                n.OnsetSec,
                n.OffsetSec,
                n.Confidence
            })
        };

        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(target))!);
        File.WriteAllText(target, JsonSerializer.Serialize(payload, new JsonSerializerOptions
        {
            WriteIndented = false,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        }));

        output.WriteLine($"wrote {target}");
    }
}
