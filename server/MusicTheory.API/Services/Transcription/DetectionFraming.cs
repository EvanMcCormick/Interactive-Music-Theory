namespace MusicTheory.API.Services.Transcription;

/// <summary>
/// Cutting mono audio into the overlapping windows Basic Pitch's graph expects.
/// </summary>
/// <remarks>
/// <para>
/// A port of the client's <c>detection-framing.ts</c>, and it has to be one:
/// the two tiers must cut the audio at the same sample or every note in the
/// result is displaced. That file exists because the library's own
/// <c>prepareData</c> crashes the WebGL shader compiler on a sixteenth of
/// song-length inputs — a defect with no analogue here, since nothing on this
/// side compiles a shader. What survives the port is not the workaround but
/// the layout, which is <c>tf.signal.frame(padded, 43844, 36164, true, 0)</c>
/// and must stay exactly that.
/// </para>
/// <para>
/// The windows overlap by 30 frames, so the framed result is about 1.21x the
/// length of the audio. Half that overlap is trimmed off each end of each
/// window's output again by <see cref="BasicPitchDetector"/>, which is what the
/// lead-in below exists to make symmetric.
/// </para>
/// </remarks>
public static class DetectionFraming
{
    /// <summary>The rate audio is handed to the model at. It rejects any other.</summary>
    public const int DetectionSampleRate = 22050;

    /// <summary>Samples per model frame. The model's own <c>FFT_HOP</c>.</summary>
    public const int FftHop = 256;

    /// <summary>Samples in one window: two seconds less a frame.</summary>
    public const int WindowSamples = DetectionSampleRate * 2 - FftHop;

    /// <summary>Frames each window shares with its neighbour.</summary>
    public const int OverlapFrames = 30;

    /// <summary>Samples of that overlap.</summary>
    public const int OverlapSamples = OverlapFrames * FftHop;

    /// <summary>Samples between the starts of consecutive windows.</summary>
    public const int WindowHop = WindowSamples - OverlapSamples;

    /// <summary>
    /// Silence prepended ahead of the first sample, so that the first window's
    /// output has the same half-overlap trimmed from its front as every other
    /// window's.
    /// </summary>
    public const int LeadInSamples = OverlapSamples / 2;

    /// <summary>
    /// How many windows <paramref name="sampleCount"/> samples is cut into.
    /// </summary>
    /// <remarks>
    /// <c>tf.signal.frame</c> starts a window at every multiple of the hop that
    /// falls inside the signal and zero-fills the last one, so this is the
    /// signal length — lead-in included — over the hop, rounded up.
    /// </remarks>
    public static int WindowCountFor(int sampleCount) =>
        (int)Math.Ceiling((LeadInSamples + (double)sampleCount) / WindowHop);

    /// <summary>
    /// <paramref name="audio"/> as consecutive windows of
    /// <see cref="WindowSamples"/> samples, flat.
    /// </summary>
    /// <returns>
    /// One array holding every window end to end, and how many there are.
    /// Flat rather than jagged so a window can be handed to the model as a span
    /// with no copy; a four-minute stem is 161 windows and 28 MB either way.
    /// </returns>
    public static (float[] Windows, int WindowCount) FrameForModel(ReadOnlySpan<float> audio)
    {
        var windowCount = WindowCountFor(audio.Length);
        var framed = new float[(long)windowCount * WindowSamples];

        for (var window = 0; window < windowCount; window++)
        {
            // Where this window starts in the lead-in-plus-audio signal, and
            // how much of its head falls in the lead-in. Only the first window
            // has any, since the hop is far longer than the lead-in, but saying
            // so in arithmetic rather than in a special case is what keeps the
            // two ends symmetric.
            var start = window * WindowHop;
            var silentHead = Math.Max(0, LeadInSamples - start);
            var from = start + silentHead - LeadInSamples;

            // Short on the last window, which runs off the end of the audio.
            // Whatever is left of it stays zero, which is `padEnd`'s padValue.
            var count = Math.Min(WindowSamples - silentHead, audio.Length - from);

            if (count > 0)
            {
                audio.Slice(from, count)
                    .CopyTo(framed.AsSpan(window * WindowSamples + silentHead, count));
            }
        }

        return (framed, windowCount);
    }
}
