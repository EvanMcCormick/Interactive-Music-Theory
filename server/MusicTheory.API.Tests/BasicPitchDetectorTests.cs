using System.Buffers.Binary;
using System.Text.Json;
using System.Text.Json.Serialization;
using MusicTheory.API.Services.Transcription;
using Xunit.Abstractions;

namespace MusicTheory.API.Tests;

/// <summary>
/// The whole server pipeline — framing, batch loop, both trims, decoder, bends,
/// ordering — against the library's own end-to-end path on the same audio.
/// </summary>
/// <remarks>
/// <para>
/// This is the piece the other suites cannot reach.
/// <c>BasicPitchModelTests</c> pins one window through the network;
/// <c>BasicPitchNotesDifferentialTests</c> pins the decoder given
/// posteriorgrams. Everything between a file and a note sits in the gap, and
/// every part of it is arithmetic that produces plausible output when it is
/// slightly wrong. A frame miscounted at the tail displaces the end of the
/// file. An overlap trimmed from the wrong end displaces all of it. Neither
/// throws.
/// </para>
/// <para>
/// The reference comes from <c>BasicPitch.evaluateModel</c>, which frames with
/// the library's own <c>prepareData</c> — the function the client replaces. So
/// this checks <see cref="DetectionFraming"/> against the definition it was
/// ported from rather than against the port's sibling.
/// </para>
/// <para>
/// <b>Exact equality is the wrong assertion here and is not used.</b> The two
/// runtimes agree on the model to 4.5e-7, which is float32 rounding, but a
/// detection sitting on the 0.3 frame threshold can still fall either side of
/// it — the design says so, having watched a fixture's 86 same-attack pairs
/// come back as 89 from a live session. What is asserted is musical: the same
/// notes, at the same pitches, within a frame.
/// </para>
/// </remarks>
public class BasicPitchDetectorTests(ITestOutputHelper output)
{
    /// <summary>One model frame, 11.6 ms. The finest distinction the model can draw.</summary>
    private const double OneFrameSec = 1.0 / BasicPitchDetector.BendFrameRateHz;

    private static readonly string ReferencePath = Path.Combine(
        AppContext.BaseDirectory,
        "Vectors",
        "basic-pitch-pipeline",
        "pipeline.json");

    [Fact]
    public void Pipeline_finds_the_notes_the_library_finds()
    {
        var reference = LoadReference();
        var audio = BuildReferenceAudio(reference);

        Assert.Equal(reference.InputHash, HashFloats(audio));

        using var detector = new BasicPitchDetector();
        var result = detector.Detect(audio, reference.SampleRate);

        output.WriteLine($"library {reference.Notes.Length} notes, server {result.Notes.Count}");
        foreach (var note in result.Notes)
        {
            output.WriteLine(
                $"  {note.Id,-6} midi {note.Pitch,3}  {note.OnsetSec,7:F4}s"
                + $" - {note.OffsetSec,7:F4}s  conf {note.Confidence:F4}"
                + $"  {note.BendCents.Count} bend frames");
        }

        Assert.Equal(reference.BendFrameRateHz, result.BendFrameRateHz);
        Assert.Equal(reference.Notes.Length, result.Notes.Count);

        for (var i = 0; i < reference.Notes.Length; i++)
        {
            var want = reference.Notes[i];
            var got = result.Notes[i];
            var where = $"note {i} of {reference.Notes.Length}";

            Assert.Equal(want.Id, got.Id);
            Assert.True(want.Pitch == got.Pitch, $"{where}: pitch {got.Pitch}, expected {want.Pitch}");

            Assert.True(
                Math.Abs(want.OnsetSec - got.OnsetSec) <= OneFrameSec,
                $"{where}: onset {got.OnsetSec:F4}s, expected {want.OnsetSec:F4}s");
            Assert.True(
                Math.Abs(want.OffsetSec - got.OffsetSec) <= OneFrameSec,
                $"{where}: offset {got.OffsetSec:F4}s, expected {want.OffsetSec:F4}s");

            // Confidence is a mean over the note's frames, so the model's
            // 4.5e-7 averages down rather than up. A tolerance three orders
            // above it still catches a note built from the wrong frames.
            Assert.True(
                Math.Abs(want.Confidence - got.Confidence) < 1e-4,
                $"{where}: confidence {got.Confidence:F6}, expected {want.Confidence:F6}");

            Assert.True(
                want.BendCents.Length == got.BendCents.Count,
                $"{where}: {got.BendCents.Count} bend frames, expected {want.BendCents.Length}");
        }
    }

    /// <summary>
    /// The played pitches come back, which no amount of agreement between two
    /// implementations would establish on its own.
    /// </summary>
    /// <remarks>
    /// Both could be wrong in the same way — that is exactly what a port
    /// reproduces best. The six frequencies are decimal literals chosen to be
    /// E2 A2 C3 E3 G3 B3, so the MIDI numbers are known independently of
    /// anything either runtime computes.
    /// </remarks>
    [Fact]
    public void Pipeline_finds_the_pitches_that_were_synthesised()
    {
        var reference = LoadReference();
        var audio = BuildReferenceAudio(reference);

        using var detector = new BasicPitchDetector();
        var result = detector.Detect(audio, reference.SampleRate);

        int[] played = [40, 45, 48, 52, 55, 59];
        var found = result.Notes.Select(n => n.Pitch).Distinct().OrderBy(p => p).ToArray();

        output.WriteLine($"played {string.Join(" ", played)}");
        output.WriteLine($"found  {string.Join(" ", found)}");

        foreach (var pitch in played)
        {
            Assert.Contains(pitch, found);
        }
    }

    [Fact]
    public void Detect_rejects_audio_at_the_wrong_sample_rate()
    {
        using var detector = new BasicPitchDetector();

        var thrown = Assert.Throws<ArgumentException>(
            () => detector.Detect(new float[1000], 44100));

        Assert.Contains("22050", thrown.Message);
    }

    [Fact]
    public void Detect_reports_progress_ending_at_exactly_one()
    {
        var reference = LoadReference();
        var audio = BuildReferenceAudio(reference);

        var reported = new List<double>();

        using var detector = new BasicPitchDetector();
        detector.Detect(audio, reference.SampleRate, reported.Add);

        Assert.NotEmpty(reported);
        Assert.Equal(1.0, reported[^1]);
        Assert.All(reported, fraction => Assert.InRange(fraction, 0.0, 1.0));
    }

    /// <summary>
    /// Mirrors <c>buildAudio</c> in <c>client/tools/basic-pitch-pipeline.cjs</c>.
    /// </summary>
    /// <remarks>
    /// Every constant is a decimal literal and every operation is multiply, add
    /// or floor, so both runtimes produce bit-identical samples — which the
    /// hash asserted by the caller is what proves.
    /// </remarks>
    private static float[] BuildReferenceAudio(PipelineReference reference)
    {
        var samples = new float[reference.SampleCount];
        var noteSamples = reference.SampleCount / reference.Frequencies.Length;

        for (var note = 0; note < reference.Frequencies.Length; note++)
        {
            var frequency = reference.Frequencies[note];
            var start = note * noteSamples;
            var level = 0.6;

            for (var i = 0; i < noteSamples; i++)
            {
                var phase = i * frequency / reference.SampleRate;
                samples[start + i] = (float)(level * (2 * (phase - Math.Floor(phase)) - 1));
                level *= 0.99985;
            }
        }

        return samples;
    }

    /// <summary>FNV-1a over the little-endian float32 bit patterns.</summary>
    private static uint HashFloats(float[] values)
    {
        Span<byte> buffer = stackalloc byte[4];
        var hash = 0x811c9dc5u;

        foreach (var value in values)
        {
            BinaryPrimitives.WriteSingleLittleEndian(buffer, value);
            foreach (var b in buffer)
            {
                hash ^= b;
                hash = unchecked(hash * 0x01000193u);
            }
        }

        return hash;
    }

    private static PipelineReference LoadReference()
    {
        if (!File.Exists(ReferencePath))
        {
            throw new FileNotFoundException(
                $"Pipeline reference missing at {ReferencePath}. Regenerate with "
                + "`cd client && node tools/basic-pitch-pipeline.cjs "
                + "../server/MusicTheory.API.Tests/Vectors/basic-pitch-pipeline`.",
                ReferencePath);
        }

        return JsonSerializer.Deserialize<PipelineReference>(File.ReadAllText(ReferencePath))
               ?? throw new InvalidOperationException("Pipeline reference did not deserialise.");
    }

    internal sealed record PipelineReference
    {
        [JsonPropertyName("sampleRate")]
        public int SampleRate { get; init; }

        [JsonPropertyName("sampleCount")]
        public int SampleCount { get; init; }

        [JsonPropertyName("frequencies")]
        public double[] Frequencies { get; init; } = [];

        [JsonPropertyName("inputHash")]
        public uint InputHash { get; init; }

        [JsonPropertyName("modelFrames")]
        public int ModelFrames { get; init; }

        [JsonPropertyName("bendFrameRateHz")]
        public double BendFrameRateHz { get; init; }

        [JsonPropertyName("notes")]
        public ReferenceNote[] Notes { get; init; } = [];
    }

    internal sealed record ReferenceNote
    {
        [JsonPropertyName("id")]
        public string Id { get; init; } = string.Empty;

        [JsonPropertyName("pitch")]
        public int Pitch { get; init; }

        [JsonPropertyName("onsetSec")]
        public double OnsetSec { get; init; }

        [JsonPropertyName("offsetSec")]
        public double OffsetSec { get; init; }

        [JsonPropertyName("confidence")]
        public double Confidence { get; init; }

        [JsonPropertyName("bendCents")]
        public double[] BendCents { get; init; } = [];
    }
}
