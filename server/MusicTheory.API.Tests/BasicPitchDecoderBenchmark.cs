using System.Diagnostics;
using MusicTheory.API.Services.Transcription;
using MusicTheory.API.Tests.Vectors;
using Xunit.Abstractions;

namespace MusicTheory.API.Tests;

/// <summary>
/// The reason the decoder was ported: what it costs at the scale of a real
/// stem.
/// </summary>
/// <remarks>
/// <para>
/// The input is the same generator the differential tests use, sized to the
/// file <c>real-detections.fixture.ts</c> was captured from — 22,616 frames is
/// a 4:22 stem at 22.05 kHz on a 256-sample hop — and planted at the density
/// that decodes to roughly its 1,224 detections. Same seed, same matrices, on
/// both runtimes, so the comparison is a comparison rather than two unrelated
/// measurements.
/// </para>
/// <para>
/// Run the other half with <c>cd client &amp;&amp; node
/// tools/basic-pitch-vectors.cjs --bench</c>.
/// </para>
/// <para>
/// It asserts a ceiling rather than a target, and a loose one: the point of the
/// number is the order of magnitude, and a wall-clock assertion tight enough to
/// be interesting is a wall-clock assertion that fails on a busy CI box. What
/// would be worth failing on is a return to seconds, which is what the ceiling
/// catches.
/// </para>
/// </remarks>
[Trait("Category", "Benchmark")]
public class BasicPitchDecoderBenchmark(ITestOutputHelper output)
{
    private const uint Seed = 20260907;
    private const int Frames = 22616;
    private const int Pitches = 88;
    private const int PlantedNotes = 600;

    [Fact]
    public void Decodes_a_stem_sized_posteriorgram_in_well_under_a_second()
    {
        var built = Stopwatch.StartNew();
        var (frames, onsets, contours) = BasicPitchVectors.Generate(
            Seed,
            Frames,
            Pitches,
            PlantedNotes);
        built.Stop();

        var decode = Stopwatch.StartNew();
        var notes = BasicPitchNotes.OutputToNotesPoly(frames, onsets);
        var decoded = decode.Elapsed;
        var withBends = BasicPitchBends.AddPitchBendsToNoteEvents(contours, notes);
        decode.Stop();

        output.WriteLine($"generate            {built.Elapsed.TotalMilliseconds,8:F0} ms");
        output.WriteLine(
            $"OutputToNotesPoly   {decoded.TotalMilliseconds,8:F0} ms   {notes.Count} notes");
        output.WriteLine(
            "AddPitchBends       "
            + $"{(decode.Elapsed - decoded).TotalMilliseconds,8:F0} ms");
        output.WriteLine($"decode total        {decode.Elapsed.TotalMilliseconds,8:F0} ms");

        Assert.NotEmpty(withBends);

        // Measured at 161 ms on a developer machine in Release, against 17.5 s
        // for the TypeScript on the identical input. The ceiling is a whole
        // order of magnitude above that, because the failure worth catching is
        // not a slow morning on CI: dropping RowMaxIndex and going back to
        // rescanning the matrix costs 1.8 s, and that is what trips this.
        Assert.True(
            decode.Elapsed.TotalSeconds < 1.0,
            $"decode took {decode.Elapsed.TotalSeconds:F2}s for {Frames} frames, "
            + "against 0.16s measured; at 1.8s the melodia loop is rescanning the "
            + "matrix and at 17s it is the TypeScript");
    }
}
