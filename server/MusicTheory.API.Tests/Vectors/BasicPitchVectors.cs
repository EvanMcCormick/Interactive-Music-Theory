using System.Buffers.Binary;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MusicTheory.API.Tests.Vectors;

/// <summary>
/// The C# half of the differential apparatus: regenerates the same
/// posteriorgrams <c>client/tools/basic-pitch-vectors.cjs</c> generated, and
/// loads the answers the TypeScript gave for them.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="Generate"/> is a line-for-line mirror of that file's
/// <c>generate</c>. It has to be, and nothing here can tell whether it still
/// is — which is what <see cref="HashMatrix"/> is for. The generator is built
/// out of the PRNG, addition, multiplication, comparison and integer
/// arithmetic and nothing else, all of which IEEE 754 pins exactly, so the two
/// languages produce bit-identical matrices or the hash says they did not.
/// </para>
/// <para>
/// The alternative — committing the matrices themselves — is about a hundred
/// megabytes for one real stem, and would still only cover the branches that
/// one bass line happens to reach.
/// </para>
/// </remarks>
internal static class BasicPitchVectors
{
    private const int ContourBinsPerSemitone = 3;

    private static readonly Lazy<VectorFile> Loaded = new(() =>
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Vectors", "basic-pitch-vectors.json");
        if (!File.Exists(path))
        {
            throw new FileNotFoundException(
                $"Differential vectors missing at {path}. Regenerate with "
                + "`cd client && node tools/basic-pitch-vectors.cjs`.",
                path);
        }

        return JsonSerializer.Deserialize<VectorFile>(File.ReadAllText(path))
               ?? throw new InvalidOperationException("Differential vectors did not deserialise.");
    });

    public static VectorFile File_ => Loaded.Value;

    /// <summary>
    /// xorshift32, expressed in the operations JavaScript and C# agree on
    /// exactly.
    /// </summary>
    /// <remarks>
    /// The JavaScript writes <c>(x ^ (x &lt;&lt; 13)) &gt;&gt;&gt; 0</c>, which
    /// is int32 bitwise arithmetic reinterpreted as unsigned. On <c>uint</c>
    /// that reinterpretation is what the type already means, so the shifts
    /// below are the same operation without the ceremony. Dividing by 2^32 is
    /// exact.
    /// </remarks>
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

    /// <summary>
    /// FNV-1a over the big-endian bytes of every element — the proof that both
    /// sides generated the same input before either decoded it.
    /// </summary>
    /// <remarks>
    /// Big-endian because that is what JavaScript's <c>DataView</c> writes
    /// unless told otherwise, and this machine is not.
    /// </remarks>
    public static uint HashMatrix(double[][] rows)
    {
        Span<byte> buffer = stackalloc byte[8];
        var hash = 0x811c9dc5u;

        foreach (var row in rows)
        {
            foreach (var value in row)
            {
                BinaryPrimitives.WriteDoubleBigEndian(buffer, value);
                foreach (var b in buffer)
                {
                    hash ^= b;
                    hash = unchecked(hash * 0x01000193u);
                }
            }
        }

        return hash;
    }

    /// <summary>
    /// Builds one case's three posteriorgrams. Mirrors <c>generate</c> in
    /// <c>client/tools/basic-pitch-vectors.cjs</c>; change one and change both.
    /// </summary>
    public static (double[][] Frames, double[][] Onsets, double[][] Contours) Generate(
        uint seed,
        int nFrames,
        int nPitches,
        int nNotes)
    {
        var rnd = new Xorshift32(seed);
        var nBins = nPitches * ContourBinsPerSemitone;

        var frames = Zeros(nFrames, nPitches);
        var onsets = Zeros(nFrames, nPitches);
        var contours = Zeros(nFrames, nBins);

        // Floor noise, well below the 0.3 frame threshold: it decides nothing
        // by itself but breaks every tie the melodia pass would otherwise hit.
        for (var t = 0; t < nFrames; t++)
        {
            for (var p = 0; p < nPitches; p++)
            {
                frames[t][p] = rnd.Next() * 0.08;
                onsets[t][p] = rnd.Next() * 0.08;
            }

            for (var b = 0; b < nBins; b++)
            {
                contours[t][b] = rnd.Next() * 0.05;
            }
        }

        for (var n = 0; n < nNotes; n++)
        {
            var start = (int)Math.Floor(rnd.Next() * (nFrames - 1));
            var length = 4 + (int)Math.Floor(rnd.Next() * 60);
            var pitch = 4 + (int)Math.Floor(rnd.Next() * (nPitches - 24));

            var peak = 0.55 + rnd.Next() * 0.45;

            // Straddles the 0.5 onset threshold on purpose: below it the onset
            // pass never sees an attack and the melodia trick has to recover
            // the note, which is the branch most worth pinning.
            var onsetPeak = 0.3 + rnd.Next() * 0.68;

            var level = peak;
            var end = Math.Min(start + length, nFrames);
            var wobble = 0;

            for (var t = start; t < end; t++)
            {
                frames[t][pitch] = Math.Max(frames[t][pitch], level);

                // The octave and the twelfth. Basic Pitch over-detects both
                // above a plucked fundamental, and they are what make the
                // decoder's neighbour-clearing matter.
                if (pitch + 12 < nPitches)
                {
                    frames[t][pitch + 12] = Math.Max(frames[t][pitch + 12], level * 0.55);
                }

                if (pitch + 19 < nPitches)
                {
                    frames[t][pitch + 19] = Math.Max(frames[t][pitch + 19], level * 0.35);
                }

                // A slow integer wander, so bends are non-trivial without a
                // transcendental to shape them.
                if (rnd.Next() < 0.08)
                {
                    wobble += rnd.Next() < 0.5 ? -1 : 1;
                }

                var centre = pitch * ContourBinsPerSemitone + wobble;
                for (var d = -6; d <= 6; d++)
                {
                    var bin = centre + d;
                    if (bin >= 0 && bin < nBins)
                    {
                        var falloff = 1 - d * d / 49.0;
                        contours[t][bin] = Math.Max(contours[t][bin], level * falloff);
                    }
                }

                level *= 0.985;
            }

            onsets[start][pitch] = Math.Max(onsets[start][pitch], onsetPeak);
            if (pitch + 12 < nPitches)
            {
                onsets[start][pitch + 12] =
                    Math.Max(onsets[start][pitch + 12], onsetPeak * 0.5);
            }
        }

        return (frames, onsets, contours);
    }

    private static double[][] Zeros(int rows, int cols)
    {
        var result = new double[rows][];
        for (var r = 0; r < rows; r++)
        {
            result[r] = new double[cols];
        }

        return result;
    }

    internal sealed record VectorFile
    {
        [JsonPropertyName("library")]
        public string Library { get; init; } = string.Empty;

        [JsonPropertyName("gaussian")]
        public double[] Gaussian { get; init; } = [];

        [JsonPropertyName("scalars")]
        public ScalarVectors Scalars { get; init; } = new();

        [JsonPropertyName("cases")]
        public VectorCase[] Cases { get; init; } = [];
    }

    internal sealed record ScalarVectors
    {
        [JsonPropertyName("hzToMidi440")]
        public double HzToMidi440 { get; init; }

        [JsonPropertyName("midiToHz69")]
        public double MidiToHz69 { get; init; }

        [JsonPropertyName("midiPitchToContourBin")]
        public double[] MidiPitchToContourBin { get; init; } = [];

        [JsonPropertyName("modelFrameToTime")]
        public double[] ModelFrameToTime { get; init; } = [];
    }

    internal sealed record VectorCase
    {
        [JsonPropertyName("name")]
        public string Name { get; init; } = string.Empty;

        [JsonPropertyName("seed")]
        public uint Seed { get; init; }

        [JsonPropertyName("nFrames")]
        public int NFrames { get; init; }

        [JsonPropertyName("nPitches")]
        public int NPitches { get; init; }

        [JsonPropertyName("nNotes")]
        public int NNotes { get; init; }

        [JsonPropertyName("inputHash")]
        public InputHash InputHash { get; init; } = new();

        [JsonPropertyName("notes")]
        public VectorNote[] Notes { get; init; } = [];
    }

    internal sealed record InputHash
    {
        [JsonPropertyName("frames")]
        public uint Frames { get; init; }

        [JsonPropertyName("onsets")]
        public uint Onsets { get; init; }

        [JsonPropertyName("contours")]
        public uint Contours { get; init; }
    }

    internal sealed record VectorNote
    {
        [JsonPropertyName("startFrame")]
        public int StartFrame { get; init; }

        [JsonPropertyName("durationFrames")]
        public int DurationFrames { get; init; }

        [JsonPropertyName("pitchMidi")]
        public int PitchMidi { get; init; }

        [JsonPropertyName("amplitude")]
        public double Amplitude { get; init; }

        [JsonPropertyName("pitchBends")]
        public int[] PitchBends { get; init; } = [];

        [JsonPropertyName("startTimeSeconds")]
        public double StartTimeSeconds { get; init; }

        [JsonPropertyName("durationSeconds")]
        public double DurationSeconds { get; init; }
    }
}
