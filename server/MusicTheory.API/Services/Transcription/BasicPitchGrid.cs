namespace MusicTheory.API.Services.Transcription;

/// <summary>
/// The geometry of Basic Pitch's output: the constants that describe its time
/// and frequency grids, and the conversions between that grid and musical
/// units.
/// </summary>
/// <remarks>
/// Split out of <see cref="BasicPitchNotes"/> only because every other file in
/// this folder needs it. It is the <c>PORTED LIBROSA FUNCTIONS</c> section of
/// <c>toMidi.ts</c> plus the module constants above it, unchanged; the port's
/// argument for reading against that file line by line is in
/// <see cref="BasicPitchNotes"/>, which also says where each other section
/// went.
/// </remarks>
internal static class BasicPitchGrid
{
    internal const int MidiOffset = 21;
    internal const double AudioSampleRate = 22050.0;
    internal const double AudioWindowLength = 2.0;
    internal const double FftHop = 256.0;

    /// <summary>
    /// 86, the <em>floored</em> frame rate.
    /// </summary>
    /// <remarks>
    /// This exists to count frames and to place window boundaries, and nothing
    /// else should use it: the true rate is 86.13 Hz, and the client's
    /// <c>BEND_FRAME_RATE_HZ</c> says why reporting the floored value to a bend
    /// consumer walks it a whole frame off its note every 6.5 seconds.
    /// </remarks>
    internal const double AnnotationsFps = 86.0; // Math.floor(22050 / 256)

    internal const double AnnotNFrames = AnnotationsFps * AudioWindowLength;
    internal const double AudioNSamples = AudioSampleRate * AudioWindowLength - FftHop;

    /// <summary>
    /// Correction for the model's window overlap. The trailing 0.0018 is a magic
    /// number in the original and stays one here — it is not derived from
    /// anything, it is what makes the windows line up.
    /// </summary>
    internal const double WindowOffset =
        FftHop / AudioSampleRate * (AnnotNFrames - AudioNSamples / FftHop) + 0.0018;

    internal const int MaxFreqIdx = 87;
    internal const int ContoursBinsPerSemitone = 3;
    internal const double AnnotationsBaseFrequency = 27.5; // lowest key on a piano
    internal const int AnnotationsNSemitones = 88; // number of piano keys
    internal const int NFreqBinsContours = AnnotationsNSemitones * ContoursBinsPerSemitone;

    // ----- ported librosa -----

    internal static double HzToMidi(double hz) => 12.0 * (Math.Log2(hz) - Math.Log2(440.0)) + 69.0;

    internal static double MidiToHz(double midi) => 440.0 * Math.Pow(2.0, (midi - 69.0) / 12.0);

    /// <summary>Model frame to seconds, undoing the window overlap as it goes.</summary>
    internal static double ModelFrameToTime(int frame) =>
        frame * FftHop / AudioSampleRate - WindowOffset * Math.Floor(frame / AnnotNFrames);

    /// <summary>
    /// Where a MIDI pitch sits on the contour posteriorgram's own grid, which is
    /// three bins to a semitone counting up from A0.
    /// </summary>
    /// <remarks>
    /// <b>The one measured place where this file does not return the same double
    /// as the browser.</b> <c>Math.Pow</c> disagrees with V8's by an ulp — MIDI
    /// 40 is 82.406889228217494 Hz here and 82.40688922821748 there — which
    /// carries into a bin of 57.000000000000007 against an exact 57. It cannot
    /// reach a bend: the grid is three bins to a semitone above A0, so the true
    /// bin is the integer <c>3p - 63</c> for every pitch the model can emit, and
    /// the caller rounds. <c>Contour_bins_round_to_the_same_integer_as_the_TypeScript</c>
    /// measures the headroom across the whole 88-key range rather than trusting
    /// the argument.
    /// </remarks>
    internal static double MidiPitchToContourBin(double pitchMidi) =>
        12.0 * ContoursBinsPerSemitone * Math.Log2(MidiToHz(pitchMidi) / AnnotationsBaseFrequency);
}
