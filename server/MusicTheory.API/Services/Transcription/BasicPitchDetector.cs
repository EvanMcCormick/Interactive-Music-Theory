namespace MusicTheory.API.Services.Transcription;

/// <summary>
/// Audio in, notes out. The server's half of the two-tier design's
/// <c>NoteDetector</c>.
/// </summary>
/// <remarks>
/// <para>
/// A port of the client's <c>basic-pitch-detector.ts</c>, and specifically of
/// its <c>infer</c> loop, which mirrors the library's <c>evaluateModel</c>
/// structurally. Everything that made the client's version unusual is a
/// browser problem and none of it is here: no asynchronous WebGL readback that
/// never resolves in a worker, no shader that fails to compile, no tensors to
/// dispose. What survives is the arithmetic, which has to survive exactly.
/// </para>
///
/// <para><b>The two trims are the whole difficulty.</b></para>
///
/// <para>
/// The first is per window. Windows overlap by 30 frames, so each window's 172
/// frames of output are cut to the middle 142 — 15 off each end — before being
/// concatenated. That is the library's <c>unwrapOutput</c>, and
/// <see cref="DetectionFraming.LeadInSamples"/> exists so the first window has
/// a front to lose like every other.
/// </para>
/// <para>
/// The second is at the tail, and it is the subtle one. The model runs over
/// windows that overshoot the audio, so the concatenated output is longer than
/// the file and the last useful window has to be cut short. Two details decide
/// where:
/// </para>
/// <list type="bullet">
///   <item><description>The frame rate is <b>floored</b> to 86 for this count,
///   not the true 86.13. That is what the library does, and disagreeing with
///   it shifts the output in time.</description></item>
///   <item><description><c>framesSoFar</c> advances by the window's
///   <em>untrimmed</em> 142 rows even when fewer were kept. It reads like a
///   bug and it is load-bearing: it is what makes the loop stop after the
///   window that crossed the line rather than grinding on to fill a quota it
///   can never reach.</description></item>
/// </list>
/// <para>
/// The trim is measured against the audio as handed in. Anything that makes
/// the framed input longer than the audio — silence included — must leave that
/// number alone, or the extra windows' frames are kept.
/// </para>
///
/// <para>
/// One difference from the library, inherited from the client: the
/// frames-wanted test happens <em>before</em> a window is run rather than after.
/// Same output, one less inference.
/// </para>
/// </remarks>
public sealed class BasicPitchDetector : IDisposable
{
    /// <summary>
    /// Rate at which the model reports frames, and so the rate
    /// <see cref="DetectedNote.BendCents"/> is sampled at.
    /// </summary>
    /// <remarks>
    /// 86.13 Hz, not the 86 the library floors it to. That floored value exists
    /// only to count how many frames of output an input should produce;
    /// <c>ModelFrameToTime</c>, which is what actually places notes in time,
    /// uses the unrounded ratio. Reporting 86 here would walk a bend a whole
    /// frame off its note every 6.5 seconds.
    /// </remarks>
    public const double BendFrameRateHz =
        (double)DetectionFraming.DetectionSampleRate / DetectionFraming.FftHop;

    /// <summary>The floored rate, which is only ever a frame count.</summary>
    private const int AnnotationsFps =
        DetectionFraming.DetectionSampleRate / DetectionFraming.FftHop;

    /// <summary>Frames trimmed from each end of a window's output.</summary>
    private const int OverlapOverTwo = DetectionFraming.OverlapFrames / 2;

    /// <summary>Contour bins per semitone in the model's bend output.</summary>
    private const int ContourBinsPerSemitone = 3;

    private readonly BasicPitchModel _model;
    private readonly bool _ownsModel;

    public BasicPitchDetector(string? modelPath = null)
        : this(new BasicPitchModel(modelPath), ownsModel: true)
    {
    }

    /// <param name="model">
    /// A model to share. One session is reusable across calls and is documented
    /// thread-safe, so a hosted service holds one and hands it to every request.
    /// </param>
    /// <param name="ownsModel">
    /// Whether disposing this should dispose the model too.
    /// </param>
    public BasicPitchDetector(BasicPitchModel model, bool ownsModel = false)
    {
        _model = model;
        _ownsModel = ownsModel;
    }

    /// <summary>
    /// Detects the notes in <paramref name="audio"/>.
    /// </summary>
    /// <param name="audio">Mono samples at <see cref="DetectionFraming.DetectionSampleRate"/>.</param>
    /// <param name="sampleRate">
    /// Checked rather than resampled: the decoder upstream already resamples
    /// properly, and a second, worse resampler here would be a silent downgrade.
    /// </param>
    /// <param name="onProgress">Called with 0-1 as inference proceeds, ending at exactly 1.</param>
    public DetectionResult Detect(
        ReadOnlySpan<float> audio,
        int sampleRate,
        Action<double>? onProgress = null)
    {
        if (sampleRate != DetectionFraming.DetectionSampleRate)
        {
            throw new ArgumentException(
                $"Basic Pitch needs audio at {DetectionFraming.DetectionSampleRate} Hz, "
                + $"was given {sampleRate}.",
                nameof(sampleRate));
        }

        var (frames, onsets, contours) = Infer(audio, onProgress);

        var notes = BasicPitchNotes.OutputToNotesPoly(frames, onsets);
        var withBends = BasicPitchBends.AddPitchBendsToNoteEvents(contours, notes);
        var timed = BasicPitchNotes.NoteFramesToTime(withBends);

        // OutputToNotesPoly walks the posteriorgram pitch by pitch, so what it
        // returns is in no useful order at all. Pitch breaks the ties, so this
        // does not lean on the sort being stable.
        var ordered = timed
            .OrderBy(note => note.StartTimeSeconds)
            .ThenBy(note => note.PitchMidi)
            .ToList();

        var detected = new List<DetectedNote>(ordered.Count);
        for (var i = 0; i < ordered.Count; i++)
        {
            detected.Add(ToDetectedNote(ordered[i], i));
        }

        return new DetectionResult(detected, BendFrameRateHz);
    }

    /// <summary>
    /// The batch loop: frame the audio, run each window, trim twice, concatenate.
    /// </summary>
    private (double[][] Frames, double[][] Onsets, double[][] Contours) Infer(
        ReadOnlySpan<float> audio,
        Action<double>? onProgress)
    {
        var audioOriginalLength = audio.Length;
        var (windows, windowCount) = DetectionFraming.FrameForModel(audio);

        // The library floors the frame rate to count output frames, and this
        // trim has to agree with it exactly or the output shifts in time.
        var framesWanted = (int)Math.Floor(
            audioOriginalLength * ((double)AnnotationsFps / DetectionFraming.DetectionSampleRate));

        var frames = new List<double[]>();
        var onsets = new List<double[]>();
        var contours = new List<double[]>();
        var framesSoFar = 0;

        for (var window = 0; window < windowCount; window++)
        {
            onProgress?.Invoke((double)window / windowCount);

            if (framesSoFar >= framesWanted)
            {
                continue;
            }

            var span = windows.AsSpan(
                window * DetectionFraming.WindowSamples,
                DetectionFraming.WindowSamples);

            var raw = _model.Run(span);

            var batchFrames = raw.Frames.Length - 2 * OverlapOverTwo;
            var keep = Math.Min(batchFrames, framesWanted - framesSoFar);

            Append(frames, raw.Frames, keep);
            Append(onsets, raw.Onsets, keep);
            Append(contours, raw.Contours, keep);

            // The untrimmed count, deliberately. See the class docblock.
            framesSoFar += batchFrames;
        }

        onProgress?.Invoke(1);

        return (frames.ToArray(), onsets.ToArray(), contours.ToArray());
    }

    /// <summary>
    /// Appends the middle of one window's output, cut short at
    /// <paramref name="keep"/> rows.
    /// </summary>
    /// <remarks>
    /// The overlap trim and the tail trim in one pass: skipping the first
    /// <see cref="OverlapOverTwo"/> rows is <c>unwrapOutput</c>, and stopping at
    /// <paramref name="keep"/> is the frames-wanted cut. The rows are the
    /// model's own arrays, handed over rather than copied, because nothing
    /// reads them again.
    /// </remarks>
    private static void Append(List<double[]> destination, double[][] windowOutput, int keep)
    {
        for (var row = 0; row < keep; row++)
        {
            destination.Add(windowOutput[OverlapOverTwo + row]);
        }
    }

    /// <summary>
    /// A timed note event as the domain model wants it.
    /// </summary>
    /// <remarks>
    /// <c>amplitude</c> becomes <c>Confidence</c>, and it is the library's field
    /// name that is wrong rather than ours — see <see cref="NoteEvent"/>.
    /// </remarks>
    private static DetectedNote ToDetectedNote(NoteEventTime note, int index) =>
        new()
        {
            Id = $"bp-{index}",
            Pitch = note.PitchMidi,
            OnsetSec = note.StartTimeSeconds,
            OffsetSec = note.StartTimeSeconds + note.DurationSeconds,
            Confidence = note.Amplitude,
            BendCents = ToCents(note.PitchBends)
        };

    /// <summary>
    /// Basic Pitch reports bends in <em>contour bins</em>, not cents.
    /// </summary>
    /// <remarks>
    /// The contour grid is three bins to a semitone, so a bin is 100/3 cents.
    /// Passing the raw array to something documented in cents would understate
    /// every bend 33-fold.
    /// </remarks>
    private static double[] ToCents(IReadOnlyList<int>? pitchBends)
    {
        if (pitchBends is null)
        {
            return [];
        }

        const double centsPerBin = 100.0 / ContourBinsPerSemitone;
        var cents = new double[pitchBends.Count];
        for (var i = 0; i < cents.Length; i++)
        {
            cents[i] = pitchBends[i] * centsPerBin;
        }

        return cents;
    }

    public void Dispose()
    {
        if (_ownsModel)
        {
            _model.Dispose();
        }
    }
}
