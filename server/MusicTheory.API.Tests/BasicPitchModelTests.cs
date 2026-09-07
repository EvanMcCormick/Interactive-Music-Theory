using System.Buffers.Binary;
using System.Text.Json;
using MusicTheory.API.Services.Transcription;
using Xunit.Abstractions;

namespace MusicTheory.API.Tests;

/// <summary>
/// Holds the ONNX weights the server runs against the TF.js graph the browser
/// runs, on the same window of audio.
/// </summary>
/// <remarks>
/// <para>
/// The two tiers have to agree about notes, and this is the layer where a
/// disagreement would start. <c>nmp.onnx</c> is Spotify's own <c>tf2onnx</c>
/// export rather than a conversion done here, which is reassuring and is not
/// evidence: it is a different serialisation run by a different runtime.
/// </para>
/// <para>
/// The reference is frozen by <c>client/tools/basic-pitch-reference.cjs</c>, so
/// this runs with no Node, no TF.js and no browser — the property
/// <c>real-detections.fixture.ts</c> has for the same reason. Regenerate it
/// with <c>cd client &amp;&amp; node tools/basic-pitch-reference.cjs
/// ../server/MusicTheory.API.Tests/Vectors/basic-pitch-reference</c>, and read
/// any diff rather than accepting it.
/// </para>
/// <para>
/// The input is regenerated here rather than committed — it is two sawtooths
/// and a seeded noise floor, all exact in double arithmetic — and checked
/// against a hash before anything is compared, so an input that has drifted
/// fails as itself rather than as a wrong model.
/// </para>
/// </remarks>
public class BasicPitchModelTests(ITestOutputHelper output)
{
    /// <summary>
    /// Comfortably above the 4.5e-7 measured when this was first run, and far
    /// below anything that could move a note: the decoder's thresholds are 0.3
    /// and 0.5, so a disagreement would have to be six thousand times larger
    /// than this to change even a borderline detection.
    /// </summary>
    private const double Tolerance = 1e-5;

    private static readonly string ReferenceDir =
        Path.Combine(AppContext.BaseDirectory, "Vectors", "basic-pitch-reference");

    [Fact]
    public void Onnx_weights_reproduce_the_TFjs_graph_on_the_same_window()
    {
        var summary = LoadSummary();
        var input = BuildReferenceInput();

        Assert.Equal(
            summary.GetProperty("inputHash").GetUInt32(),
            HashFloats(input));

        using var model = new BasicPitchModel();
        var actual = model.Run(input);

        Compare("frames", ReadFloats("frames.f32"), actual.Frames, BasicPitchModel.PitchBins);
        Compare("onsets", ReadFloats("onsets.f32"), actual.Onsets, BasicPitchModel.PitchBins);
        Compare("contours", ReadFloats("contours.f32"), actual.Contours, BasicPitchModel.ContourBins);
    }

    /// <summary>
    /// The half of the check that the tolerance above cannot do.
    /// </summary>
    /// <remarks>
    /// Frames and onsets are both <c>[172, 88]</c> and the ONNX output names
    /// say nothing about which is which, so a swapped mapping would run
    /// perfectly and transcribe nonsense — every note starting where the
    /// previous one was still sounding. This asserts the swap is loud: the
    /// wrong pairing differed by 0.745 when measured, against 4.5e-7 for the
    /// right one.
    /// </remarks>
    [Fact]
    public void Frames_and_onsets_are_not_interchangeable()
    {
        var input = BuildReferenceInput();

        using var model = new BasicPitchModel();
        var actual = model.Run(input);

        var crossed = MaxAbsoluteDifference(
            ReadFloats("frames.f32"),
            actual.Onsets,
            BasicPitchModel.PitchBins);

        output.WriteLine($"frames against onsets: {crossed:E3}");
        Assert.True(
            crossed > 0.1,
            $"frames and onsets differ by only {crossed:E3}, so this test can no "
            + "longer tell a correct mapping from a swapped one");
    }

    [Fact]
    public void Model_reports_the_shapes_the_decoder_expects()
    {
        using var model = new BasicPitchModel();
        var result = model.Run(BuildReferenceInput());

        Assert.Equal(BasicPitchModel.AnnotNFrames, result.Frames.Length);
        Assert.Equal(BasicPitchModel.AnnotNFrames, result.Onsets.Length);
        Assert.Equal(BasicPitchModel.AnnotNFrames, result.Contours.Length);
        Assert.All(result.Frames, row => Assert.Equal(BasicPitchModel.PitchBins, row.Length));
        Assert.All(result.Onsets, row => Assert.Equal(BasicPitchModel.PitchBins, row.Length));
        Assert.All(result.Contours, row => Assert.Equal(BasicPitchModel.ContourBins, row.Length));
    }

    [Fact]
    public void Model_rejects_a_window_of_the_wrong_length()
    {
        using var model = new BasicPitchModel();

        // The graph's input dimension is fixed, so this is a mistake worth
        // naming rather than letting the runtime report it in its own terms.
        var thrown = Assert.Throws<ArgumentException>(
            () => model.Run(new float[BasicPitchModel.AudioNSamples - 1]));

        Assert.Contains("43844", thrown.Message);
    }

    private void Compare(string name, float[] expected, double[][] actual, int bins)
    {
        Assert.Equal(expected.Length, actual.Length * bins);

        var max = MaxAbsoluteDifference(expected, actual, bins);
        output.WriteLine($"{name,-9} max |onnx - tfjs| = {max:E3}");

        Assert.True(
            max < Tolerance,
            $"{name}: ONNX and TF.js differ by {max:E3}, over the {Tolerance:E0} "
            + "tolerance. Either the vendored weights are not the export this was "
            + "frozen against, or the runtime has changed how it computes them.");
    }

    private static double MaxAbsoluteDifference(float[] expected, double[][] actual, int bins)
    {
        var max = 0.0;

        for (var frame = 0; frame < actual.Length; frame++)
        {
            for (var bin = 0; bin < bins; bin++)
            {
                var difference = Math.Abs(expected[frame * bins + bin] - actual[frame][bin]);
                if (difference > max)
                {
                    max = difference;
                }
            }
        }

        return max;
    }

    /// <summary>
    /// Mirrors <c>buildInput</c> in <c>client/tools/basic-pitch-reference.cjs</c>.
    /// </summary>
    /// <remarks>
    /// Sawtooths rather than sines: <c>phase - floor(phase)</c> is exact for
    /// every double, so this produces bit-identical samples in both runtimes,
    /// where <c>Math.sin</c> would not be pinned to the last bit.
    /// </remarks>
    private static float[] BuildReferenceInput()
    {
        const int sampleRate = 22050;
        var samples = new float[BasicPitchModel.AudioNSamples];
        var random = new Xorshift32(20260907);

        static double Sawtooth(int sampleIndex, double frequency, double amplitude)
        {
            var phase = sampleIndex * frequency / sampleRate;
            return amplitude * (2 * (phase - Math.Floor(phase)) - 1);
        }

        for (var i = 0; i < samples.Length; i++)
        {
            var value = Sawtooth(i, 110, 0.35);
            if (i > BasicPitchModel.AudioNSamples / 3.0)
            {
                value += Sawtooth(
                    i - (int)Math.Floor(BasicPitchModel.AudioNSamples / 3.0),
                    164.8,
                    0.25);
            }

            samples[i] = (float)(value + (random.Next() - 0.5) * 0.02);
        }

        return samples;
    }

    private sealed class Xorshift32(uint seed)
    {
        private uint _state = seed == 0 ? 0x9e3779b9 : seed;

        public double Next()
        {
            _state ^= _state << 13;
            _state ^= _state >> 17;
            _state ^= _state << 5;
            return _state / 4294967296.0;
        }
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

    private static JsonElement LoadSummary()
    {
        var path = Path.Combine(ReferenceDir, "summary.json");
        RequireReference(path);
        return JsonDocument.Parse(File.ReadAllText(path)).RootElement;
    }

    private static float[] ReadFloats(string fileName)
    {
        var path = Path.Combine(ReferenceDir, fileName);
        RequireReference(path);

        var bytes = File.ReadAllBytes(path);
        var values = new float[bytes.Length / sizeof(float)];
        Buffer.BlockCopy(bytes, 0, values, 0, bytes.Length);
        return values;
    }

    private static void RequireReference(string path)
    {
        if (!File.Exists(path))
        {
            throw new FileNotFoundException(
                $"TF.js reference missing at {path}. Regenerate with "
                + "`cd client && node tools/basic-pitch-reference.cjs "
                + "../server/MusicTheory.API.Tests/Vectors/basic-pitch-reference`.",
                path);
        }
    }
}
