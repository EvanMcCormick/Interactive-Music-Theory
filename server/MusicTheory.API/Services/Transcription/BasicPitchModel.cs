using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;

namespace MusicTheory.API.Services.Transcription;

/// <summary>
/// Basic Pitch's neural network, running under
/// <c>Microsoft.ML.OnnxRuntime</c>.
/// </summary>
/// <remarks>
/// <para>
/// The weights are Spotify's own <c>tf2onnx</c> export — <c>nmp.onnx</c> from
/// the Python distribution, Apache-2.0 with no carve-out for the model, unlike
/// the licence question that gates separation. Nothing was converted here.
/// That is reassuring and it is not evidence: a different serialisation run by
/// a different runtime still has to produce the same numbers as the browser,
/// and <c>BasicPitchModelTests</c> is what establishes that it does — every
/// output within 4.5e-7 of the TF.js graph on the same window, which is
/// float32 rounding.
/// </para>
/// <para>
/// <b>The output mapping is measured, not read off the names.</b> Two of the
/// three outputs are <c>[batch, 172, 88]</c> and the ONNX names carry no hint
/// which is which, so a frames/onsets swap would run perfectly and produce
/// nonsense. The comparison that settled it showed 4.5e-7 for the pairing
/// below and 0.745 for the other one.
/// </para>
/// <list type="table">
///   <item><term>contours</term><description><c>Identity</c> /
///   <c>StatefulPartitionedCall:0</c>, 264 bins</description></item>
///   <item><term>frames</term><description><c>Identity_1</c> /
///   <c>StatefulPartitionedCall:1</c>, 88 pitches</description></item>
///   <item><term>onsets</term><description><c>Identity_2</c> /
///   <c>StatefulPartitionedCall:2</c>, 88 pitches</description></item>
/// </list>
/// <para>
/// One session, reused. Loading the graph per request would cost a file read
/// and a fresh set of kernel initialisations every time, and the session is
/// documented thread-safe for concurrent <c>Run</c>.
/// </para>
/// <para>
/// <b>This is the model and not yet the detector.</b> It runs one window.
/// Turning a file into notes also needs the framing that cuts audio into
/// overlapping windows, the batch loop, the overlap trim
/// (<c>unwrapOutput</c>), and the trim to the frame count the audio implies —
/// all of which the client has in <c>detection-framing.ts</c> and
/// <c>basic-pitch-detector.ts</c>, and none of which is ported yet.
/// </para>
/// </remarks>
public sealed class BasicPitchModel : IDisposable
{
    /// <summary>
    /// Samples per window: <c>22050 * 2 - 256</c>. The graph's input dimension
    /// is fixed at this, so a window of any other length is rejected by the
    /// runtime rather than resampled.
    /// </summary>
    public const int AudioNSamples = 43844;

    /// <summary>Frames of output per window: <c>floor(22050 / 256) * 2</c>.</summary>
    public const int AnnotNFrames = 172;

    /// <summary>Pitch bins in the frame and onset posteriorgrams. 88 piano keys.</summary>
    public const int PitchBins = 88;

    /// <summary>Bins in the contour posteriorgram. Three per semitone.</summary>
    public const int ContourBins = 264;

    /// <summary>Where the weights sit relative to the running application.</summary>
    public const string DefaultModelPath = "MlModels/basic-pitch/nmp.onnx";

    private const string ContoursOutput = "StatefulPartitionedCall:0";
    private const string FramesOutput = "StatefulPartitionedCall:1";
    private const string OnsetsOutput = "StatefulPartitionedCall:2";

    private readonly InferenceSession _session;
    private readonly string _inputName;

    public BasicPitchModel(string? modelPath = null)
    {
        var path = modelPath ?? Path.Combine(AppContext.BaseDirectory, DefaultModelPath);
        if (!File.Exists(path))
        {
            throw new FileNotFoundException(
                $"Basic Pitch weights not found at '{path}'. They ship with the API "
                + "project under MlModels/basic-pitch and are copied to the output "
                + "directory on build.",
                path);
        }

        _session = new InferenceSession(path);
        _inputName = _session.InputMetadata.Keys.Single();
    }

    /// <summary>
    /// Runs one window of mono 22.05 kHz audio through the network.
    /// </summary>
    /// <param name="window">Exactly <see cref="AudioNSamples"/> samples.</param>
    /// <returns>
    /// The three posteriorgrams, each <c>[frame][bin]</c>, widened to
    /// <c>double</c>.
    /// </returns>
    /// <remarks>
    /// Widened because everything downstream is a transliteration of
    /// JavaScript, which has no other kind of number: summing float32
    /// activations in float32 would drift from the browser on long notes for
    /// no reason at all. Widening is exact, so the sums then match. See
    /// <see cref="BasicPitchNotes"/>.
    /// </remarks>
    public Posteriorgrams Run(ReadOnlySpan<float> window)
    {
        if (window.Length != AudioNSamples)
        {
            throw new ArgumentException(
                $"Basic Pitch takes windows of exactly {AudioNSamples} samples, "
                + $"was given {window.Length}.",
                nameof(window));
        }

        var input = new DenseTensor<float>(new[] { 1, AudioNSamples, 1 });
        window.CopyTo(input.Buffer.Span);

        using var results = _session.Run(
            [NamedOnnxValue.CreateFromTensor(_inputName, input)],
            [ContoursOutput, FramesOutput, OnsetsOutput]);

        var byName = results.ToDictionary(r => r.Name, r => r.AsTensor<float>());

        return new Posteriorgrams(
            Widen(byName[FramesOutput], PitchBins),
            Widen(byName[OnsetsOutput], PitchBins),
            Widen(byName[ContoursOutput], ContourBins));
    }

    /// <summary>
    /// Flattens the leading batch dimension away and widens to
    /// <c>double[frame][bin]</c>.
    /// </summary>
    private static double[][] Widen(Tensor<float> tensor, int bins)
    {
        var values = tensor.ToArray();
        var frames = values.Length / bins;
        var result = new double[frames][];

        for (var f = 0; f < frames; f++)
        {
            var row = new double[bins];
            for (var b = 0; b < bins; b++)
            {
                row[b] = values[f * bins + b];
            }

            result[f] = row;
        }

        return result;
    }

    public void Dispose() => _session.Dispose();
}

/// <summary>
/// The network's three outputs for one window, each <c>[frame][bin]</c>.
/// </summary>
/// <param name="Frames">Per-pitch activation: is this note sounding.</param>
/// <param name="Onsets">Per-pitch activation: does a note start here.</param>
/// <param name="Contours">
/// Pitch contour at three bins to a semitone, which is what a bend is read
/// off.
/// </param>
public readonly record struct Posteriorgrams(
    double[][] Frames,
    double[][] Onsets,
    double[][] Contours);
