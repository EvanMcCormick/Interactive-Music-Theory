namespace MusicTheory.API.Services.Transcription;

/// <summary>
/// Raw output of a note detector, before any musical interpretation.
/// </summary>
/// <remarks>
/// <para>
/// The client's <c>DetectedNote</c>, field for field, because this is what
/// crosses the wire and the client is already built around that shape. Times
/// are absolute seconds into the source audio, deliberately not beats: this is
/// what the model observed, and it stays true whatever tempo, meter or tuning
/// is later chosen. Everything in a score is derived from these, so changing an
/// interpretation never means re-running detection.
/// </para>
/// <para>
/// That is also the line the two-tier design cuts along. Detections are facts,
/// shared and content-addressed; the interpretation on top of them is per user.
/// The server produces this and stops.
/// </para>
/// </remarks>
public sealed record DetectedNote
{
    /// <summary>
    /// Position in the sorted result, as <c>bp-0</c>, <c>bp-1</c>, and so on.
    /// </summary>
    /// <remarks>
    /// Stable for a given detection, which is all anything downstream asks of
    /// it — a note's identity does not survive re-running detection anyway.
    /// </remarks>
    public required string Id { get; init; }

    /// <summary>MIDI pitch.</summary>
    public required int Pitch { get; init; }

    public required double OnsetSec { get; init; }

    public required double OffsetSec { get; init; }

    /// <summary>0-1, straight from the model.</summary>
    /// <remarks>
    /// The mean of the note's frame activations across its span, and a poor
    /// proxy for how hard the note was played: measured across 49 detected
    /// notes spanning 17.7 dB of pluck strength, its correlation with that is
    /// r = 0.182. <c>basic-pitch-detector.ts</c> argues it at length.
    /// </remarks>
    public required double Confidence { get; init; }

    /// <summary>
    /// Per-frame deviation in cents. Empty when the note has no bend.
    /// </summary>
    /// <remarks>
    /// Sampled at <see cref="DetectionResult.BendFrameRateHz"/>, which this
    /// record deliberately does not carry: a bend array is useless without the
    /// rate, so whoever hands out the notes hands out the rate too.
    /// </remarks>
    public required IReadOnlyList<double> BendCents { get; init; }
}

/// <summary>What a detector returns for one piece of audio.</summary>
/// <param name="Notes">In onset order, ties broken by pitch.</param>
/// <param name="BendFrameRateHz">
/// Frame rate of <see cref="DetectedNote.BendCents"/>.
/// </param>
public sealed record DetectionResult(
    IReadOnlyList<DetectedNote> Notes,
    double BendFrameRateHz);
