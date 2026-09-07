namespace MusicTheory.API.Services.Transcription;

/// <summary>
/// A note as <see cref="BasicPitchNotes.OutputToNotesPoly"/> builds it: timed in
/// model frames, because that is the only clock the posteriorgram has.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="Amplitude"/> carries the library's field name and the library's
/// field name is wrong. It is the <em>mean</em> of the note's frame activations
/// across its span — not a peak, not a level, and not a calibrated probability.
/// The client calls it <c>confidence</c> when it crosses into the domain model
/// and <c>basic-pitch-detector.ts</c> argues the point at length, including the
/// measurement that settles it: across 49 detected notes spanning 17.7 dB of
/// pluck strength its correlation with how hard the note was played is
/// r = 0.182. The name is kept here, and only here, so that this file reads
/// against <c>toMidi.ts</c> line for line.
/// </para>
/// </remarks>
public sealed record NoteEvent
{
    public required int StartFrame { get; init; }

    public required int DurationFrames { get; init; }

    public required int PitchMidi { get; init; }

    public required double Amplitude { get; init; }

    /// <summary>
    /// Per-frame deviation from the nominal pitch, in <em>contour bins</em>.
    /// Null until <see cref="BasicPitchNotes.AddPitchBendsToNoteEvents"/> has run.
    /// </summary>
    /// <remarks>
    /// Bins, not cents. The contour grid is three bins to a semitone, so a
    /// consumer that hands these to anything documented in cents understates
    /// every bend 33-fold — the conversion belongs at the boundary where the
    /// domain model starts, which is where the client does it.
    /// </remarks>
    public IReadOnlyList<int>? PitchBends { get; init; }
}

/// <summary>
/// The same note with its frames resolved to seconds by
/// <see cref="BasicPitchNotes.NoteFramesToTime"/>.
/// </summary>
public sealed record NoteEventTime
{
    public required double StartTimeSeconds { get; init; }

    public required double DurationSeconds { get; init; }

    public required int PitchMidi { get; init; }

    public required double Amplitude { get; init; }

    /// <inheritdoc cref="NoteEvent.PitchBends"/>
    public IReadOnlyList<int>? PitchBends { get; init; }
}
